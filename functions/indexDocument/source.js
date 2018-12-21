exports = function(changeEvent) {
  checkConfiguredValues();
  indexDocument(changeEvent, false);
};

function checkConfiguredValues() {
  if(!context.values.get("ES_URL")) {
    console.error("Elastisearch URL (ES_URL) is not configured in Values");
  }
  if(!context.values.get("AUTH_HEADER")) {
    console.error("Authorization header (AUTH_HEADER) is not configured in Values");
  }
}

function indexDocument(changeEvent, indexingPreviouslyFailed) {
  const http = context.services.get("es-http");
  
  // set default URL and HTTP action
  const docId = docIdToString(changeEvent.documentKey._id);
  const url = context.values.get("ES_URL") + "/" + docId;
  let httpAction = http.put;
  switch(changeEvent.operationType) {
    case "insert":
      break;
    // TODO: write separate logic for update vs replace
    // so document is only partially indexed for updates
    case "update":
    case "replace":
      httpAction = http.post;
      break;
    case "delete":
      httpAction = http.delete;
      break;
  }
  
  // remove _id field from fullDocument as otherwise ES returns a mapper_parsing_exception
  if (changeEvent.fullDocument && changeEvent.fullDocument._id) {
    delete changeEvent.fullDocument._id;
  }
  
  // make the request to ES
  if (!indexingPreviouslyFailed) {
    console.log("Indexing document from database trigger...");
  } else {
    console.log("Indexing previously failed document...");
  }
  const req = buildHttpRequest(url, changeEvent);
  return httpAction(req).then(resp => {
    if (resp.statusCode === 200 || resp.statusCode === 201) {
      console.log("Successfully indexed document in ES (2xx):");
      console.log(resp.body.text());
      if (!indexingPreviouslyFailed) {
        // any errors thrown while calling indexPreviouslyFailedDocuments() will still be 
        // caught here, so setting indexingPreviouslyFailed to false explicitly so
        // storeFailedDocId() is not called on these errors
        indexingPreviouslyFailed = true;
        indexPreviouslyFailedDocuments(changeEvent);
      }
      return resp.body.text();
    } else {
      console.error("ES server returned an error: " + resp.body.text());
      storeFailedDocId(changeEvent, indexingPreviouslyFailed);
    }
  }).catch((err) => {
    console.error("Error while doing POST request: " + JSON.stringify(err));
    storeFailedDocId(changeEvent, indexingPreviouslyFailed);
  });
}

// need to serialize docId as string as ES only supports string IDs
function docIdToString(docId) {
  if (typeof(docId) !== "string") {
    return JSON.stringify(docId);
  } else {
    return docId;
  }
}

function buildHttpRequest(url, changeEvent) {
  return {
    "url": url,
    "headers": {
      "Content-Type": ["application/json"],
      "Authorization": ["Basic " + context.values.get("AUTH_HEADER")]
    },
    "encodeBodyAsJSON": true,
    "body": changeEvent.fullDocument,
  };
}

// IDs of failed documents along with the operationType are stored in the DB es-failed
// so that they can be retried later after a successful indexing action
function storeFailedDocId(changeEvent, indexingPreviouslyFailed) {
  const docId = changeEvent.documentKey._id;
  if (!indexingPreviouslyFailed) {
    const doc = { "_id": docId, "operationType": changeEvent.operationType, "failed": 1 };
    _storeFailedDocId(doc).catch(err => {
      console.error("Error while storing document failed to index: " + err)});
  } else {
    incrementFailed(changeEvent, docId).catch(err => {
      console.error("Error while incrementing nr of failures for failed doc" + err)});
  }
}

function _storeFailedDocId(doc) {
  const mongodb = context.services.get("mongodb-atlas");
  const collection = mongodb.db("es-failed").collection("docs");
  return collection.insertOne(doc);
}

// if a previously failed document failes again, increment the fails counter
// as to not keep retrying docs indefinitely
function incrementFailed(changeEvent, docId) {
  const mongodb = context.services.get("mongodb-atlas");
  const collection = mongodb.db("es-failed").collection("docs");
  return collection.updateOne({_id: docId}, { $inc: { "failed": 1 }});
}

function indexPreviouslyFailedDocuments(changeEvent) {
  // get current db and collection from changeEvent
  const db = changeEvent.ns.db;
  const coll = changeEvent.ns.coll;
  // get IDs of previously failed documents
  getPreviouslyFailedDocuments().then(docs => {
    for (let i = 0; i < docs.length; i++ ) {
      const doc = docs[i];
      const docId = doc._id;
      // using the IDs, retrieve the full documents so we can try to index them again
      getPreviouslyFailedFullDocument(docId, db, coll).then(fullDoc => {
        if (fullDoc) {
          const changeEventFailedDoc = buildChangeEventFailedDoc(docId, doc.operationType, fullDoc);
          indexDocument(changeEventFailedDoc, true).then(success => {
            if (success) {
              deletePreviouslyFailedDocument(docId).catch(err => {
                console.error("Error while deleting previously failed doc from DB: " + err)});
            }
          }).catch(err => console.error("Error while indexing previously failed doc: " + err));
        } else {
          console.error("Could not find previously failed full document with ID: " + docId);
        }
      }).catch(err => {
        console.error("Error while retrieving previously failed full doc from DB: " + err)});
    }
  }).catch(err => console.error("Error while retrieving previously failed docs from DB: " + err));
}

function getPreviouslyFailedDocuments() {
  const mongodb = context.services.get("mongodb-atlas");
  const collection = mongodb.db("es-failed").collection("docs");
  // only retrieve previously failed documents that have been retried 2 times or less
  // so we don't keep retrying indefinitely
  return collection.find({"failed": { $lte: 3 }}).toArray();
}

function getPreviouslyFailedFullDocument(docId, db, coll) {
  const mongodb = context.services.get("mongodb-atlas");
  const collection = mongodb.db(db).collection(coll);
  return collection.findOne({"_id": docId});
}

// we don't have to create the entire changeEvent object for previously failed documents,
// only have to add the properties we need
function buildChangeEventFailedDoc(docId, operationType, fullDocument) {
  return {
    documentKey: { 
      _id: docId
    }, 
    operationType: operationType,
    fullDocument: fullDocument
  };
}

function deletePreviouslyFailedDocument(docId) {
  const mongodb = context.services.get("mongodb-atlas");
  const collection = mongodb.db("es-failed").collection("docs");
  return collection.deleteOne({"_id": docId});
}
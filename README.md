Introduction
------------
MongoDB Stitch app for synchronizing data to Elasticsearch.

It includes a Database Trigger and a Stitch function. The function makes an HTTP request to 
Elasticsearch to index the document that is supplied with the change stream. If the request fails, 
it will store the ID and operation-type in a separate database and collection to retry later. 
Everytime a request succeeds, it will query this collection and retry any previously failed 
documents. This ensures that Elasticsearch remains in sync even in the event of errors or outages.

*Disclaimer: this is NOT in any way an official MongoDB product or project.*

Import & configuration
----------------------
Clone or download this project and use (https://docs.mongodb.com/stitch/import-export/stitch-cli-reference/)[Stich CLI]
to import it:
```bash
$ stitch-cli login --username=cloud.username --api-key=my-api-key
$ stitch-cli import
```

After importing the app, update the database and collection of the Database Trigger to point to the 
database and collection that needs to be indexed in Elasticsearch. This can be configured on the 
Edit Trigger screen of the Database Trigger.

Then update the Elasticsearch URL and the authorization header. These can be configured through 
Values in the Stitch UI.

First, change the Elasticsearch URL by updating the ES_URL value. Please note that the URL should 
contain the index and type in the URL and should not contain a trailing slash.

Finally, update the HTTP authorization header. This header needs to be Base64 encoded. To create a 
Base64 string execute the following command on Mac/Linux: 
```bash
echo -n 'USERNAME:PASSWORD' | openssl base64
```

Replace the value of the AUTH_HEADER in Stitch with the output of the command.

You should now be good to go! You can test the app by inserting a document into the collection that 
the Database Trigger is configured on. If all goes well, you should see a log entry in the Logs 
section in Stitch with status OK shortly after inserting the document. Finally, you’d want to verify 
that the document has successfully been indexed in Elasticsearch by querying using the document’s 
ID.

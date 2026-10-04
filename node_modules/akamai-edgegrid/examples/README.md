# Examples

This directory contains executable CRUD examples for Akamai API using the EdgeGrid Node library. API calls used in these examples are available to all users. But, if you find one of the write examples does not work for you, talk with your account's admin about your privilege level.

## Run

To run any of the files:

1. Append the path to your `.edgerc`. The default is set to the home directory.
2. Provide the section heading for the set of credentials you'd like to use. The default is `default`.
3. For update and delete operations, replace the dummy `credentialId` with your valid `credentialId`.

   > **Important:** Don't use the credentials you're actively using when running the update (inactivation) and delete operations. Otherwise, you'll block your access to the Akamai APIs.

4. Open a Terminal or shell instance and run the .js file.

    ```shell
    $ node examples/<file-name>.js
    ```

## Sample files

The example in each file contains a call to one of the Identity and Access Management (IAM) API endpoints. See the [IAM API reference](https://techdocs.akamai.com/iam-api/reference/api) doc for more information on each of the calls used.

| Operation | Method | Endpoint |
|---|---|---|
| [`List your API client credentials.`](/examples/get-credentials.js)| `GET` | `/identity-management/v3/api-clients/self/credentials`|
| [`Create new API client credentials.`](/examples/create-credentials.js) <br /> This is a *quick* client and grants you the default permissions associated with your account. | `POST` | `/identity-management/v3/api-clients/self/credentials` |
| [`Update your credentials by ID.`](/examples/update-credentials.js) | `PUT` | `/identity-management/v3/api-clients/self/credentials/{credentialId}`|
| [`Delete your credentials by ID.`](/examples/delete-credentials.js) | `DELETE` | `/identity-management/v3/api-clients/self/credentials/{credentialId}`|

Suggested chained call order:

1. Get credentials to see your base information.
2. Create client to create a new set of credentials.
3. Update credentials to inactivate the newly created set from step 2.
4. Delete client to delete the inactivated credentials.
5. Get credentials and verify the credentials are gone (status will be `DELETED`).
# Globals and dynamic variables

API Manager keeps globals, collection variables, folder variables, and environments on this computer. Open **Globals** in the sidebar to add a reusable value. Open **Environments** to choose a group of values for a server or project. Enter `{{baseUrl}}` in a request to use a variable named `baseUrl`.

Dynamic variables require no saved value. Enter `{{$timestamp}}` for the current UNIX time in **seconds**, `{{$isoTimestamp}}` for UTC time, or `{{$guid}}` for a UUID. The opening and closing characters are double curly braces. Names are case-sensitive: `{{$randomIPV6}}` and `{{$randomUserName}}` use their documented capitalization.

```text
URL:     {{baseUrl}}/orders?created={{$timestamp}}
Header:  X-Request-ID: {{$guid}}
Body:    {"id":"{{$guid}}","created":{{$timestamp}},"email":"{{$randomExampleEmail}}"}
```

In pre-request or post-response scripts, use the same syntax through `pm.variables.replaceIn()`:

```javascript
const requestId = pm.variables.replaceIn('{{$guid}}');
const sentAt = pm.variables.replaceIn('{{$isoTimestamp}}');
pm.variables.set('requestId', requestId);
console.log(requestId, sentAt);
```

Each dynamic name is sampled once per send. Repeated uses in the URL, parameters, headers, body, authorization, and that send's pre-request and post-response scripts receive the same string. A later send gets a fresh sample; timestamps may match when sends occur in the same second, and small random ranges can repeat. cURL generation uses one independent sample set across the exported command. Sample values are transient unless a script explicitly saves them into a persistent scope. Saved requests and collection exports keep their `{{...}}` templates.

For saved variables, the most specific enabled value wins: globals → collection → parent folders → child folder → active environment. Script local variables take precedence during that execution. Disabled rows do not override enabled values. Duplicate enabled keys in one scope use the last row. An enabled saved variable can override a dynamic name, including `$guid`.

Values can reference other variables, including dynamic names. Whitespace around a reference is ignored (`{{ baseUrl }}`). Missing names, circular references, and references deeper than 30 levels produce an explicit error before sending. A bare `$timestamp` is ordinary text. Variable names are never evaluated as JavaScript or arbitrary Faker method calls.

## Supported names

The following 118 names match the [official Postman dynamic variable list](https://learning.postman.com/docs/tests-and-scripts/write-scripts/variables-list/), checked on October 2, 2026. Output descriptions and examples below describe API Manager's implementation. Most sample data comes from the English locale of `@faker-js/faker` (locked version 10.6.0). Examples illustrate formats; they are not fixed return values. Every replacement is a string, so add JSON quotes for text values and omit them for numeric or boolean values.

### Common

| Name | Output example or format |
| --- | --- |
| `$guid` | UUID v4, such as `c82fc18c-6592-4607-9128-286313a0e0fc` |
| `$randomUUID` | UUID v4 |
| `$timestamp` | Integer UNIX seconds, such as `1790947200` |
| `$isoTimestamp` | UTC ISO date, such as `2026-10-02T12:00:00.000Z` |

### Text, numbers, and colors

| Name | Output example or format |
| --- | --- |
| `$randomAlphaNumeric` | One character from `A-Z`, `a-z`, or `0-9` |
| `$randomBoolean` | `true` or `false` |
| `$randomInt` | Integer from 0 through 1000 |
| `$randomColor` | Color name, such as `blue` |
| `$randomHexColor` | Six-digit CSS hex color, such as `#b740e2` |
| `$randomAbbreviation` | Computing abbreviation, such as `HTTP` |

### Internet

| Name | Output example or format |
| --- | --- |
| `$randomIP` | IPv4 address |
| `$randomIPV6` | IPv6 address |
| `$randomMACAddress` | Six hexadecimal octets separated by colons |
| `$randomPassword` | 15 alphanumeric characters |
| `$randomLocale` | Two-letter language code |
| `$randomUserAgent` | Browser user-agent string |
| `$randomProtocol` | `http` or `https` |
| `$randomSemver` | Three integer components, such as `8.2.4` |

### Names and professions

| Name | Output example or format |
| --- | --- |
| `$randomFirstName` | Given name |
| `$randomLastName` | Family name |
| `$randomFullName` | Given name and family name |
| `$randomNamePrefix` | Name prefix, such as `Dr.` |
| `$randomNameSuffix` | Name suffix, such as `Jr.` |
| `$randomJobArea` | Work area |
| `$randomJobDescriptor` | Position descriptor |
| `$randomJobTitle` | Position title |
| `$randomJobType` | Position type |

### Phone, address, and location

| Name | Output example or format |
| --- | --- |
| `$randomPhoneNumber` | Ten digits grouped as `123-456-7890` |
| `$randomPhoneNumberExt` | Twelve digits grouped as `12-345-678-9012` |
| `$randomCity` | City name |
| `$randomStreetName` | Street name |
| `$randomStreetAddress` | Number and street |
| `$randomCountry` | Country name |
| `$randomCountryCode` | Uppercase two-letter country code |
| `$randomLatitude` | Latitude from -90 through 90 with up to four decimal places |
| `$randomLongitude` | Longitude from -180 through 180 with up to four decimal places |

### Images

| Name | Output example or format |
| --- | --- |
| `$randomAvatarImage` | GitHub avatar URL |
| `$randomImageUrl` | Random 640 × 480 Picsum placeholder URL |
| `$randomAbstractImage` | Placeholder URL with `abstract` seed |
| `$randomAnimalsImage` | Placeholder URL with `animals` seed |
| `$randomBusinessImage` | Placeholder URL with `business` seed |
| `$randomCatsImage` | Placeholder URL with `cats` seed |
| `$randomCityImage` | Placeholder URL with `city` seed |
| `$randomFoodImage` | Placeholder URL with `food` seed |
| `$randomNightlifeImage` | Placeholder URL with `nightlife` seed |
| `$randomFashionImage` | Placeholder URL with `fashion` seed |
| `$randomPeopleImage` | Placeholder URL with `people` seed |
| `$randomNatureImage` | Placeholder URL with `nature` seed |
| `$randomSportsImage` | Placeholder URL with `sports` seed |
| `$randomTransportImage` | Placeholder URL with `transport` seed |
| `$randomImageDataUri` | Inline SVG data URI, 640 × 480 |

Image variables generate strings locally and do not download images. The legacy LoremFlickr provider is [no longer available](https://fakerjs.dev/api/image.html#urlLoremFlickr). Category names therefore select distinct Picsum seeds rather than guarantee a photograph of the named subject. Loading an external URL later requires that image service; availability and content are controlled by the provider. The SVG data URI is self-contained.

### Finance

| Name | Output example or format |
| --- | --- |
| `$randomBankAccount` | Eight digits, including possible leading zeros |
| `$randomBankAccountName` | Account label |
| `$randomCreditCardMask` | Four digits |
| `$randomBankAccountBic` | BIC-shaped identifier |
| `$randomBankAccountIban` | IBAN-shaped identifier |
| `$randomTransactionType` | Transaction category |
| `$randomCurrencyCode` | Three-letter currency code |
| `$randomCurrencyName` | Currency name |
| `$randomCurrencySymbol` | Currency symbol |
| `$randomBitcoin` | Bitcoin-address-shaped sample |

### Business and catchphrases

| Name | Output example or format |
| --- | --- |
| `$randomCompanyName` | Company name |
| `$randomCompanySuffix` | `Inc`, `LLC`, `Group`, `Ltd`, or `Corp` |
| `$randomBs` | Business phrase |
| `$randomBsAdjective` | Business adjective |
| `$randomBsBuzz` | Business verb |
| `$randomBsNoun` | Business noun |
| `$randomCatchPhrase` | Marketing phrase |
| `$randomCatchPhraseAdjective` | Marketing adjective |
| `$randomCatchPhraseDescriptor` | Marketing descriptor |
| `$randomCatchPhraseNoun` | Marketing noun |

### Databases

| Name | Output example or format |
| --- | --- |
| `$randomDatabaseColumn` | Column label |
| `$randomDatabaseType` | Database value type |
| `$randomDatabaseCollation` | Collation name |
| `$randomDatabaseEngine` | Storage engine name |

### Dates

| Name | Output example or format |
| --- | --- |
| `$randomDateFuture` | Local date string within the next year |
| `$randomDatePast` | Local date string within the previous year |
| `$randomDateRecent` | Local date string within the preceding day |
| `$randomWeekday` | Full weekday name |
| `$randomMonth` | Full month name |

The three random date strings include the computer's timezone and may differ between computers. Use `$isoTimestamp` when the receiving API expects an ISO UTC timestamp.

### Domains, email, and usernames

| Name | Output example or format |
| --- | --- |
| `$randomDomainName` | Domain with suffix |
| `$randomDomainSuffix` | Domain suffix |
| `$randomDomainWord` | Domain label without suffix |
| `$randomEmail` | Sample email address |
| `$randomExampleEmail` | Email at `example.com`, `example.org`, or `example.net` |
| `$randomUserName` | Username |
| `$randomUrl` | HTTP or HTTPS URL |

### Files and directories

| Name | Output example or format |
| --- | --- |
| `$randomFileName` | Filename with extension |
| `$randomFileType` | File category |
| `$randomFileExt` | Extension without a dot |
| `$randomCommonFileName` | Filename from common file types |
| `$randomCommonFileType` | Common file category |
| `$randomCommonFileExt` | Common extension without a dot |
| `$randomFilePath` | Unix-style sample file path |
| `$randomDirectoryPath` | Unix-style sample directory path |
| `$randomMimeType` | MIME type |

File variables produce sample text and do not create files. A generated file path does not select an existing upload file.

### Stores

| Name | Output example or format |
| --- | --- |
| `$randomPrice` | Amount from `0.00` through `1000.00` |
| `$randomProduct` | Product category |
| `$randomProductAdjective` | Product adjective |
| `$randomProductMaterial` | Product material |
| `$randomProductName` | Product name |
| `$randomDepartment` | Store department |

### Grammar

| Name | Output example or format |
| --- | --- |
| `$randomNoun` | Computing noun |
| `$randomVerb` | Computing verb |
| `$randomIngverb` | Computing verb ending in `ing` |
| `$randomAdjective` | Computing adjective |
| `$randomWord` | One word |
| `$randomWords` | Two through five words |
| `$randomPhrase` | Computing sentence |

### Lorem text

| Name | Output example or format |
| --- | --- |
| `$randomLoremWord` | One lorem word |
| `$randomLoremWords` | Three lorem words |
| `$randomLoremSentence` | One lorem sentence |
| `$randomLoremSentences` | Two through six sentences |
| `$randomLoremParagraph` | One paragraph |
| `$randomLoremParagraphs` | Three paragraphs separated by newlines |
| `$randomLoremText` | Variable-length lorem text |
| `$randomLoremSlug` | Three words joined by hyphens |
| `$randomLoremLines` | One through five lines |

### Additional API Manager names

These seven conveniences extend the verified Postman list. Exported collections preserve them as templates, but another API client may not support them.

| Name | Output example or format |
| --- | --- |
| `$randomString` | Twelve lowercase hexadecimal characters |
| `$randomRGBColor` | CSS `rgb(r, g, b)` with components from 0 through 255 |
| `$randomPort` | Integer from 1 through 65535 |
| `$randomCreditCardNumber` | Card-number-shaped sample |
| `$randomIBAN` | Same format as `$randomBankAccountIban` |
| `$randomBIC` | Same format as `$randomBankAccountBic` |
| `$randomProductPrice` | Same format as `$randomPrice` |

## Compatibility details

API Manager uses the same explicit mapping in the editor, cURL exporter, native request engine, and script execution. Unknown names produce errors. No arbitrary Faker expressions are supported. Saved globals and environments are exported independently or with the complete workspace backup.

Samples are intended for API testing: generated people, addresses, passwords, cards, and bank details are illustrative data. Most Faker fields use its random generator; UUIDs, short random strings, passwords, phone digits, colors, and numeric helpers use the platform cryptographic random source when available. Sample distributions and English word sets can differ from the Faker version used by Postman. Dynamic aliases with the same format are separate names and receive separate samples.

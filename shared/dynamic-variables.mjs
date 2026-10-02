import { fakerEN as faker } from '@faker-js/faker';

// Explicit Postman names only: never evaluate a variable as a Faker method or code.
function randomInt(maxExclusive) {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) return faker.number.int({ min: 0, max: maxExclusive - 1 });
  const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
  const sample = new Uint32Array(1);
  do { cryptoApi.getRandomValues(sample); } while (sample[0] >= limit);
  return sample[0] % maxExclusive;
}
const pick = values => values[randomInt(values.length)];
const digits = length => Array.from({ length }, () => randomInt(10)).join('');
const hex = length => Array.from({ length }, () => pick('0123456789abcdef')).join('');
const uuid = () => globalThis.crypto?.randomUUID?.() ?? faker.string.uuid();
// Legacy category providers are retired. Picsum supplies placeholders; the seed
// carries the requested category but does not guarantee the photograph's subject.
const image = category => `https://picsum.photos/seed/${category || 'image'}-${hex(12)}/640/480`;
const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

const groups = {
  common: {
    $guid: uuid, $randomUUID: uuid,
    $timestamp: () => Math.floor(Date.now() / 1000),
    $isoTimestamp: () => new Date().toISOString(),
  },
  text: {
    $randomAlphaNumeric: () => pick(alphabet),
    $randomBoolean: () => randomInt(2) === 1,
    $randomInt: () => randomInt(1001),
    $randomColor: () => faker.color.human(),
    $randomHexColor: () => `#${hex(6)}`,
    $randomAbbreviation: () => faker.hacker.abbreviation(),
  },
  internet: {
    $randomIP: () => faker.internet.ipv4(),
    $randomIPV6: () => faker.internet.ipv6(),
    $randomMACAddress: () => faker.internet.mac(),
    $randomPassword: () => Array.from({ length: 15 }, () => pick(alphabet)).join(''),
    $randomLocale: () => faker.location.language().alpha2,
    $randomUserAgent: () => faker.internet.userAgent(),
    $randomProtocol: () => faker.internet.protocol(),
    $randomSemver: () => faker.system.semver(),
  },
  names: {
    $randomFirstName: () => faker.person.firstName(),
    $randomLastName: () => faker.person.lastName(),
    $randomFullName: () => `${faker.person.firstName()} ${faker.person.lastName()}`,
    $randomNamePrefix: () => faker.person.prefix(),
    $randomNameSuffix: () => faker.person.suffix(),
  },
  profession: {
    $randomJobArea: () => faker.person.jobArea(),
    $randomJobDescriptor: () => faker.person.jobDescriptor(),
    $randomJobTitle: () => faker.person.jobTitle(),
    $randomJobType: () => faker.person.jobType(),
  },
  location: {
    $randomPhoneNumber: () => `${digits(3)}-${digits(3)}-${digits(4)}`,
    $randomPhoneNumberExt: () => `${digits(2)}-${digits(3)}-${digits(3)}-${digits(4)}`,
    $randomCity: () => faker.location.city(),
    $randomStreetName: () => faker.location.street(),
    $randomStreetAddress: () => faker.location.streetAddress(),
    $randomCountry: () => faker.location.country(),
    $randomCountryCode: () => faker.location.countryCode('alpha-2'),
    $randomLatitude: () => faker.location.latitude({ precision: 4 }),
    $randomLongitude: () => faker.location.longitude({ precision: 4 }),
  },
  images: {
    $randomAvatarImage: () => faker.image.avatarGitHub(),
    $randomImageUrl: () => image(),
    $randomAbstractImage: () => image('abstract'),
    $randomAnimalsImage: () => image('animals'),
    $randomBusinessImage: () => image('business'),
    $randomCatsImage: () => image('cats'),
    $randomCityImage: () => image('city'),
    $randomFoodImage: () => image('food'),
    $randomNightlifeImage: () => image('nightlife'),
    $randomFashionImage: () => image('fashion'),
    $randomPeopleImage: () => image('people'),
    $randomNatureImage: () => image('nature'),
    $randomSportsImage: () => image('sports'),
    $randomTransportImage: () => image('transport'),
    $randomImageDataUri: () => faker.image.dataUri({ width: 640, height: 480, type: 'svg-uri' }),
  },
  finance: {
    $randomBankAccount: () => digits(8),
    $randomBankAccountName: () => faker.finance.accountName(),
    $randomCreditCardMask: () => digits(4),
    $randomBankAccountBic: () => faker.finance.bic(),
    $randomBankAccountIban: () => faker.finance.iban(),
    $randomTransactionType: () => faker.finance.transactionType(),
    $randomCurrencyCode: () => faker.finance.currencyCode(),
    $randomCurrencyName: () => faker.finance.currencyName(),
    $randomCurrencySymbol: () => faker.finance.currencySymbol(),
    $randomBitcoin: () => faker.finance.bitcoinAddress(),
  },
  business: {
    $randomCompanyName: () => faker.company.name(),
    $randomCompanySuffix: () => pick(['Inc', 'LLC', 'Group', 'Ltd', 'Corp']),
    $randomBs: () => faker.company.buzzPhrase(),
    $randomBsAdjective: () => faker.company.buzzAdjective(),
    $randomBsBuzz: () => faker.company.buzzVerb(),
    $randomBsNoun: () => faker.company.buzzNoun(),
  },
  catchphrases: {
    $randomCatchPhrase: () => faker.company.catchPhrase(),
    $randomCatchPhraseAdjective: () => faker.company.catchPhraseAdjective(),
    $randomCatchPhraseDescriptor: () => faker.company.catchPhraseDescriptor(),
    $randomCatchPhraseNoun: () => faker.company.catchPhraseNoun(),
  },
  databases: {
    $randomDatabaseColumn: () => faker.database.column(),
    $randomDatabaseType: () => faker.database.type(),
    $randomDatabaseCollation: () => faker.database.collation(),
    $randomDatabaseEngine: () => faker.database.engine(),
  },
  dates: {
    $randomDateFuture: () => faker.date.future({ years: 1 }).toString(),
    $randomDatePast: () => faker.date.past({ years: 1 }).toString(),
    $randomDateRecent: () => faker.date.recent({ days: 1 }).toString(),
    $randomWeekday: () => faker.date.weekday(),
    $randomMonth: () => faker.date.month(),
  },
  domains: {
    $randomDomainName: () => faker.internet.domainName(),
    $randomDomainSuffix: () => faker.internet.domainSuffix(),
    $randomDomainWord: () => faker.internet.domainWord(),
    $randomEmail: () => faker.internet.email(),
    $randomExampleEmail: () => faker.internet.exampleEmail(),
    $randomUserName: () => faker.internet.username(),
    $randomUrl: () => faker.internet.url(),
  },
  files: {
    $randomFileName: () => faker.system.fileName(),
    $randomFileType: () => faker.system.fileType(),
    $randomFileExt: () => faker.system.fileExt(),
    $randomCommonFileName: () => faker.system.commonFileName(),
    $randomCommonFileType: () => faker.system.commonFileType(),
    $randomCommonFileExt: () => faker.system.commonFileExt(),
    $randomFilePath: () => faker.system.filePath(),
    $randomDirectoryPath: () => faker.system.directoryPath(),
    $randomMimeType: () => faker.system.mimeType(),
  },
  stores: {
    $randomPrice: () => faker.commerce.price({ min: 0, max: 1000, dec: 2 }),
    $randomProduct: () => faker.commerce.product(),
    $randomProductAdjective: () => faker.commerce.productAdjective(),
    $randomProductMaterial: () => faker.commerce.productMaterial(),
    $randomProductName: () => faker.commerce.productName(),
    $randomDepartment: () => faker.commerce.department(),
  },
  grammar: {
    $randomNoun: () => faker.hacker.noun(),
    $randomVerb: () => faker.hacker.verb(),
    $randomIngverb: () => faker.hacker.ingverb(),
    $randomAdjective: () => faker.hacker.adjective(),
    $randomWord: () => faker.word.sample(),
    $randomWords: () => faker.word.words({ count: { min: 2, max: 5 } }),
    $randomPhrase: () => faker.hacker.phrase(),
  },
  lorem: {
    $randomLoremWord: () => faker.lorem.word(),
    $randomLoremWords: () => faker.lorem.words(3),
    $randomLoremSentence: () => faker.lorem.sentence(),
    $randomLoremSentences: () => faker.lorem.sentences({ min: 2, max: 6 }),
    $randomLoremParagraph: () => faker.lorem.paragraph(),
    $randomLoremParagraphs: () => faker.lorem.paragraphs(3),
    $randomLoremText: () => faker.lorem.text(),
    $randomLoremSlug: () => faker.lorem.slug(3),
    $randomLoremLines: () => faker.lorem.lines({ min: 1, max: 5 }),
  },
  extensions: {
    $randomString: () => hex(12),
    $randomRGBColor: () => `rgb(${randomInt(256)}, ${randomInt(256)}, ${randomInt(256)})`,
    $randomPort: () => randomInt(65535) + 1,
    $randomCreditCardNumber: () => faker.finance.creditCardNumber(),
    $randomIBAN: () => faker.finance.iban(),
    $randomBIC: () => faker.finance.bic(),
    $randomProductPrice: () => faker.commerce.price({ min: 0, max: 1000, dec: 2 }),
  },
};

const generators = Object.freeze(Object.assign(Object.create(null), ...Object.values(groups)));
export const SUPPORTED_DYNAMIC_VARIABLES = Object.freeze(Object.keys(generators));
export const DYNAMIC_VARIABLE_GROUPS = Object.freeze(Object.fromEntries(Object.entries(groups).map(([name, values]) => [name, Object.freeze(Object.keys(values))])));

/** Generates one sample without retaining it; callers normally use createDynamicResolver. */
export function dynamicValue(name) {
  return Object.hasOwn(generators, name) ? String(generators[name]()) : undefined;
}

/** One resolver belongs to one send/export. Its values remain stable across fields/scripts. */
export function createDynamicResolver(initial = {}) {
  const cached = new Map(Object.entries(initial).filter(([name, value]) => Object.hasOwn(generators, name) && typeof value === 'string'));
  return name => {
    if (cached.has(name)) return cached.get(name);
    const sample = dynamicValue(name);
    if (sample !== undefined) cached.set(name, sample);
    return sample;
  };
}

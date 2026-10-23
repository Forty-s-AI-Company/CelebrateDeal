/**
 * Passwords that are too easy to guess, for the new-password policy in
 * `password-policy.ts`. Built in by hand (no download, no dependency) from
 * widely published "most common password" lists plus Taiwanese and pinyin
 * habits. Every entry is lower case, already trimmed and at least 8
 * characters, because anything shorter is rejected by length first.
 *
 * Patterns are not listed here: a run of one repeated short unit
 * (`11111111`, `abababab`), straight or keyboard sequences (`23456789`,
 * `qwertyui`) and the user's own e-mail name are checked by rule.
 */
export const COMMON_PASSWORDS: readonly string[] = [
  // English and international favourites
  "password", "password1", "password12", "password123", "password1234", "password!", "password1!",
  "password123!", "passw0rd", "passw0rd1", "p@ssw0rd", "p@ssword", "p@ssword1", "p@ssw0rd1", "pa55word",
  "pa55w0rd", "passwort", "passwort1", "motdepasse", "contrasena", "senha123", "mypassword", "newpassword",
  "letmein1", "letmein123", "letmein!", "welcome1", "welcome12", "welcome123", "welcome!", "welcome2024",
  "welcome2025", "welcome2026", "trustno1", "iloveyou", "iloveyou1", "iloveyou2", "iloveyou!", "iloveyou123",
  "iloveu123", "sunshine", "sunshine1", "princess", "princess1", "football", "football1", "baseball",
  "baseball1", "basketball", "superman", "superman1", "batman123", "starwars", "starwars1", "whatever",
  "whatever1", "computer", "computer1", "internet", "jennifer", "michelle", "michael1", "jordan23",
  "liverpool", "chelsea1", "arsenal1", "manchester", "barcelona", "pokemon1", "pokemon123", "minecraft",
  "minecraft1", "fortnite", "charlie1", "danielle", "jessica1", "abcd1234!", "access14", "blink182",
  "chocolate", "butterfly", "cocacola", "elephant", "firebird", "freedom1", "hello123", "hellohello",
  "helloworld", "hello1234", "hunter22", "killer123", "lovelove", "loveyou1", "matrix123", "mercedes",
  "midnight", "mustang1", "naruto123", "nicholas", "november", "december", "september", "password2",
  "pepper123", "qwerty123!", "rainbow1", "samsung1", "samsung123", "scooter1", "security", "shadow123",
  "monkey123", "dragon123", "master123", "mastermind", "summer2024", "summer2025", "summer2026",
  "spring2026", "autumn2026", "winter2026", "thomas123", "tigger123", "victoria", "zxcvbnm1",
  "zxcvbnm123", "zxcvbnm!", "asdf1234", "asdf12345", "asdfasdf1", "qwer1234", "qwer12345", "1234qwer",
  "1234asdf", "1234abcd", "abcd1234", "abcd12345", "abcd4321", "abc12345", "abc123456", "abc1234567",
  "abcdefg1", "abcdefg123", "a1b2c3d4", "a1b2c3d4e5", "1a2b3c4d", "1a2b3c4d5e", "a12345678", "a123456789",
  "a1234567", "aa123456", "aa12345678", "aaa12345", "ab123456", "ab12345678", "qq123456", "qq12345678",
  "q1234567", "q12345678", "q123456789", "z1234567", "z12345678", "1234567a", "12345678a", "123456789a",
  "12345678q", "12345678z", "123456abc", "123456aa", "123abc123", "abc123abc", "abcabc123",
  // Keyboard walks that are not a single row
  "1qaz2wsx", "1qaz2wsx3edc", "1qazxsw2", "1qaz@wsx", "!qaz2wsx", "1q2w3e4r", "1q2w3e4r5t", "1q2w3e4r5t6y",
  "q1w2e3r4", "q1w2e3r4t5", "q1w2e3r4t5y6", "1qa2ws3ed", "zaq12wsx", "zaq1zaq1", "zaq1xsw2", "qazwsxedc",
  "qazwsx123", "qweasdzxc", "qweasd123", "qwe123qwe", "qwe12345", "qwerty12", "qwerty123", "qwerty1234",
  "qwerty12345", "qwertyqwerty", "asdfghjkl1", "asdfqwer", "qwerasdf", "zxcvasdf", "12qwaszx",
  "12qwaszx!", "1234qwerasdf", "qwer!@#$", "!@#$%^&*", "!@#$%^&*()", "1q2w3e4r!", "poiuytrewq1",
  "asdzxc123", "147258369", "159357456", "159753456", "123654789", "147852369", "963852741",
  "741852963", "321654987", "789456123", "123789456", "456789123", "741852963a", "159357852",
  "123698745", "987456321", "147896325", "258369147",
  // Digit habits
  "12345678", "123456789", "1234567890", "0123456789", "87654321", "987654321", "0987654321",
  "9876543210", "12344321", "11223344", "112233445566", "11112222", "12341234", "123123123",
  "1234512345", "123456123456", "123456654321", "1234554321", "12345678910", "13579246", "135792468",
  "24682468", "10203040", "1020304050", "20202020", "19841984", "19901990", "20002000", "20102010",
  "20242024", "20252025", "20262026", "88888888", "66666666", "168168168", "16881688", "51685168",
  "11111111", "00000000", "99999999",
  // Taiwanese, Chinese and pinyin habits
  "5201314520", "52013145", "520131400", "13145200", "1314520520", "woaini520", "woaini1314",
  "woaini123", "woaini1234", "woaini12", "woaini521", "wo123456", "wo12345678", "aini1314",
  "iloveyou520", "iloveyou1314", "love1314", "love5201314", "77585210", "775852100", "7758521a",
  "taiwan123", "taiwan2024", "taiwan2025", "taiwan2026", "taipei101", "taipei123", "taiwan01",
  "tw123456", "tw12345678", "a5201314", "z5201314", "qq5201314", "nihao123", "nihao1234", "zhang123",
  "wang1234", "chen1234", "lin12345", "huang123", "abc5201314", "baobei520", "baobei123", "laopo520",
  "laogong520", "woaiwojia", "wodemima", "mimamima", "mima1234", "mima123456",
  "xiaoming", "xiaohong", "zhongguo", "zhongguo1", "taiwanno1", "aa5201314", "1314woaini",
  "520woaini", "qwe520520", "asd520520", "kaoshi123", "pingan123",
  // Default and admin-ish choices
  "admin123", "admin1234", "admin12345", "admin123!", "administrator", "adminadmin", "root1234",
  "rootroot", "root12345", "changeme", "changeme1", "changeme123", "default1", "default123",
  "guest123", "guest1234", "user1234", "user12345", "test1234", "test12345", "test123456",
  "testtest", "testing1", "testing123", "temp1234", "temp12345", "secret123", "secret1234",
  "letmein!!", "login123", "login1234", "manager1", "manager123", "support1", "support123",
  "service1", "service123", "office123", "company1", "company123", "business1", "staff1234",
  // This product and its domain
  "celebratedeal", "celebratedeal1", "celebratedeal123", "celebrate1", "celebrate123", "celebration",
  "webinar123", "livestream", "livesales", "sales1234", "shop12345", "store1234",
];

/**
 * Short words (mostly 4 to 7 letters) that people pad with digits or symbols to
 * reach the minimum length: qwerty2026, admin2026!, 2026password. Used only
 * by the "listed word plus digits or symbols" rule, never matched alone
 * (most are shorter than the minimum anyway). Letters only, lower case.
 */
export const COMMON_PASSWORD_BASES: readonly string[] = [
  "pass", "passwd", "passw", "pwd", "qwerty", "qwert", "asdf", "asdfgh", "zxcv", "zxcvb", "qazwsx", "abcd",
  "abcde", "abcdef", "admin", "root", "login", "logon", "user", "guest", "test", "temp", "demo", "default",
  "welcome", "letmein", "hello", "hallo", "iloveu", "iloveyo", "love", "lover", "loveme", "baby", "babe",
  "angel", "honey", "sweet", "kitty", "dragon", "monkey", "master", "shadow", "tiger", "lion", "eagle",
  "batman", "hunter", "killer", "ninja", "pokemon", "naruto", "soccer", "hockey", "golf", "tennis",
  "secret", "magic", "money", "lucky", "happy", "smile", "summer", "winter", "spring", "autumn", "sunny",
  "sunshin", "flower", "orange", "banana", "apple", "cookie", "coffee", "pepper", "ginger", "purple",
  "silver", "golden", "freedom", "family", "friend", "google", "yahoo", "gmail", "facebook", "iphone",
  "samsung", "nokia", "taiwan", "taipei", "china", "woaini", "nihao", "baobei", "laopo", "laogong",
  "mima", "wode", "aini", "qwer", "asdzxc", "zaq", "michael", "jordan", "charlie", "thomas", "andrew",
  "jessica", "daniel", "george", "maggie", "ashley", "amanda", "nicole", "access", "trustno", "matrix",
  "starwar", "mustang", "corvette", "ferrari", "porsche", "harley", "yankees", "lakers", "arsenal",
  "chelsea", "liverpo", "barca", "messi", "ronaldo", "jesus", "christ", "god", "superman", "computer",
  "internet", "office", "company", "manager", "support", "service", "sales", "shop", "store",
  "password", "iloveyou", "sunshine", "football", "baseball", "princess", "whatever", "changeme",
];

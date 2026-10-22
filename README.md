# Drak a město

Webová týmová hra s QR stanovišti, úkoly ke schválení a galerií fotografií a videí.

| Oblast | Technologie | Co se tam ukládá / děje |
| --- | --- | --- |
| Aplikace a API | Next.js, React, TypeScript | Hráčská hra, administrace a serverová pravidla |
| Herní data | Prisma ORM, PostgreSQL na Neonu | Týmy, stanoviště, postup hry a provozní záznamy jako JSON stav |
| Přihlášení | Firebase Authentication | Ověření administrátora a Firebase účty vydané serverem pro týmy |
| Média | Soukromý Vercel Blob | Nahrané fotografie a videa |
| Nasazení | Vercel | Hosting Next.js aplikace a API |

## Obsah

- [Kde co v projektu najdete](#kde-co-v-projektu-najdete)
- [Příprava služeb](#příprava-služeb)
- [Proměnné prostředí](#proměnné-prostředí)
- [Nasazení na Vercel](#nasazení-na-vercel)
- [Lokální spuštění](#lokální-spuštění)
- [Databáze a změny schématu](#databáze-a-změny-schéma)
- [Přihlášení a oprávnění](#přihlášení-a-oprávnění)
- [Data ze starší verze](#data-ze-starší-verze)
- [Kontrola nasazení a řešení potíží](#kontrola-nasazení-a-řešení-potíží)

## Kde co v projektu najdete

| Cesta | Účel |
| --- | --- |
| `app/page.tsx` | Hlavní obrazovka, přihlašovací formuláře, hráčský režim a administrační rozhraní |
| `app/api/` | Serverová API: přihlášení, správa hry, týmové akce, podpora a média |
| `app/SupportChat.tsx` | Týmový chat podpory a schránka správce |
| `lib/game-store.ts` | Typy herních dat, jejich normalizace a čtení/zápis přes Prisma |
| `lib/auth.ts` | Ověření relace, role, oprávnění a hashování hesel týmů |
| `lib/firebase-client.ts` | Veřejná konfigurace Firebase pro prohlížeč |
| `lib/firebase-admin.ts` | Serverové ověření Firebase tokenů a vydávání týmových tokenů |
| `lib/db.ts` | Sdílená instance Prisma Clientu pro runtime |
| `lib/login-throttle.ts` | Databázové omezení opakovaných neúspěšných přihlášení týmů |
| `prisma/schema.prisma` | Databázové modely Prisma |
| `prisma/migrations/` | Verze SQL migrací, které se aplikují při nasazení |
| `.env.example` | Seznam potřebných nastavení prostředí bez skutečných tajných údajů |
| `package.json` | Příkazy projektu a závislosti |

Herní obsah není předvyplněný v aplikaci. Nová databáze začíná s prázdnou hrou; administrátor přidá týmy a stanoviště po přihlášení.

Administrace umožňuje nastavit u každého stanoviště i přepadové výzvy ruční schválení nebo automatické splnění. Přepad lze zadat jako textovou odpověď nebo fotografický důkaz; čekající důkazy se vyřizují v sekci **Schvalování**. Během běžící hry může každý tým až třikrát zadat soupeři vlastní přepad s fotografickým nebo video důkazem. Odevzdaný důkaz se automaticky označí jako splněný a uloží do galerie bez schválení. Čas týmu se spustí při prvním přihlášení a zobrazuje se v hráčském rozhraní i administraci. QR kódy stanovišť i týmová přihlašovací QR lze stáhnout jako SVG. Galerie médií má stránkovaný seznam, prezentaci a stažení souborů.

Další správci mohou spravovat týmy a stanoviště a sledovat čas, ale nemohou hru spustit, pozastavit ani restartovat a nemají přístup do galerie médií. Tyto ovládací prvky a galerie jsou vyhrazené hlavnímu administrátorovi.

Hlavní administrátor má navíc v sekci **Živý přehled** nástroje pro nouzové zprávy týmům, ruční splnění nebo vrácení stanoviště a živý přehled postupu. Hru může uzavřít a vyhlásit výsledky podle počtu splněných stanovišť; při shodě týmy sdílejí pořadí. Uzavření je konečné a zablokuje další herní změny.

Týmy mohou přes tlačítko **Podpora** otevřít soukromou konverzaci s pořadateli. Správci i hlavní administrátor mají v administraci společnou schránku a mohou týmům odpovídat; nové zprávy se průběžně načítají.

Aplikace běží na vlastní doméně a nenačítá obrazovky z jiných webů. Není ale offline aplikace: přihlášení a herní data vyžadují dostupný Firebase a Neon; výpadek Blobu omezuje nahrávání a přehrávání médií. Při výpadku databáze nebo hostingu nelze pokračovat v herních akcích. Automatická záložní infrastruktura ani offline synchronizace nejsou nakonfigurované.

## Příprava služeb

### 1. Firebase Authentication

1. Ve Firebase Console vytvořte projekt a zaregistrujte webovou aplikaci.
2. Otevřete **Authentication → Sign-in method** a zapněte **Email/Password**.
3. V **Authentication → Settings → Authorized domains** přidejte doménu nasazené aplikace, například `moje-aplikace.vercel.app`. Pro lokální vývoj ponechte `localhost`.
4. V **Authentication → Users** vytvořte účet administrátora. Z detailu uživatele zkopírujte jeho **UID**.
5. Ve Firebase Console otevřete nastavení projektu a zkopírujte webovou konfiguraci: API key, Auth domain, Project ID a App ID.
6. V **Project settings → Service accounts** vytvořte nebo otevřete service account a vytvořte privátní klíč JSON. Z něj potřebujete `project_id`, `client_email` a `private_key`.

V aplikaci nastavte UID administrátora jako `FIREBASE_ADMIN_UID`. Jen tento Firebase uživatel dostane administrátorskou roli; běžný Firebase účet administrátorská oprávnění nezíská.

Administrátor se přihlašuje Firebase e-mailem a heslem. Tým se přihlašuje názvem a heslem, které zadá administrátor při vytvoření týmu. Server ověří týmové heslo, vydá Firebase custom token a Firebase Admin SDK ověří následné ID tokeny. Firebase týmům nevytváří e-mailové účty.

### 2. Neon PostgreSQL

1. Vytvořte projekt a databázi na Neonu.
2. V Neonu otevřete **Connect** a zkopírujte dvě PostgreSQL connection strings:
   - **Pooled** připojení s `-pooler` v názvu hostitele vložte jako `DATABASE_URL`. Používá ho běžící aplikace na Vercelu.
   - **Direct** připojení bez `-pooler` vložte jako `DIRECT_URL`. Používají ho Prisma migrace.
3. Přihlašovací údaje a název databáze zkopírujte z Neonu celé; heslo v adrese neupravujte ani nesdílejte.

### 3. Vercel Blob

1. Ve Vercelu otevřete projekt, přejděte do **Storage** a vytvořte Blob store.
2. Úložiště používejte jako soukromé pro neveřejné fotografie a videa.
3. Zpřístupněte projektu proměnnou `BLOB_READ_WRITE_TOKEN`. Pokud ji Vercel po připojení úložiště nenastaví automaticky, zkopírujte read/write token do nastavení prostředí projektu.

Prohlížeč nahrává média přímo do Blobu. Server před vydáním upload tokenu ověřuje přihlášení týmu a při odevzdání kontroluje cestu, typ a velikost do 50 MB. Přehrání probíhá přes API aplikace s kontrolou přístupu; do herních dat se ukládá jen cesta k souboru.

## Proměnné prostředí

Začněte souborem `.env.example`; doplňte všechny hodnoty a nikdy neukládejte skutečný `.env` do Gitu. Stejné názvy použijte v **Vercel → Project → Settings → Environment Variables**.

| Proměnná | Kde ji získat | Použití |
| --- | --- | --- |
| `DATABASE_URL` | Neon, pooled connection | Prisma runtime |
| `DIRECT_URL` | Neon, direct connection | Prisma CLI a migrace |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob store | Serverové ověření a přístup k médiím |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Firebase web app config | Firebase SDK v prohlížeči |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Firebase web app config | Firebase SDK v prohlížeči |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Firebase web app config | Firebase SDK v prohlížeči |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Firebase web app config | Firebase SDK v prohlížeči |
| `FIREBASE_ADMIN_PROJECT_ID` | Firebase service account JSON: `project_id` | Server Firebase Admin SDK |
| `FIREBASE_ADMIN_CLIENT_EMAIL` | Firebase service account JSON: `client_email` | Server Firebase Admin SDK |
| `FIREBASE_ADMIN_PRIVATE_KEY` | Firebase service account JSON: `private_key` | Tajný klíč serveru; nikdy jej nedávejte do `NEXT_PUBLIC_*` |
| `FIREBASE_ADMIN_UID` | Firebase Authentication: UID admin účtu | Jediný účet s rolí administrátora |

U `FIREBASE_ADMIN_PRIVATE_KEY` vložte celý klíč jako jednu hodnotu. Pokud správce prostředí vyžaduje escapované nové řádky, použijte `\n`; server je převede na skutečné konce řádků.

Ve Vercelu při ukládání proměnných vyberte správná prostředí **Production**, **Preview** a **Development**. Preview bude sdílet data s produkcí, pokud mu nastavíte stejnou Neon databázi a Blob token. Pro oddělené testování vytvořte samostatnou Neon branch/databázi a samostatný Blob store.

## Nasazení na Vercel

1. Nahrajte projekt do Git repozitáře a ve Vercelu zvolte **Add New → Project**, potom importujte tento repozitář.
2. Vytvořte Neon databázi, Firebase projekt a Blob store podle předchozí části.
3. Vložte všechny potřebné proměnné prostředí do nastavení Vercel projektu. Po změně proměnných spusťte nový deployment.
4. V **Settings → Build and Development Settings** nastavte **Build Command**:

   ```text
   npm run db:deploy && npm run build
   ```

   `db:deploy` aplikuje SQL migrace z `prisma/migrations/` přes `DIRECT_URL`. `build` generuje Prisma Client a sestaví Next.js.
5. Nasaďte projekt. Otevřete doménu Vercel, přihlaste se Firebase administrátorským e-mailem a heslem a vytvořte první týmy a stanoviště.
6. Ověřte také týmové přihlášení, QR sken a stažení QR kódů, textové i mediální odevzdání, automatické splnění i ruční schválení stanoviště a přepadu, týmové přepady včetně limitu tří na tým a prezentaci i stažení médií v administraci. Zkontrolujte, že správce vidí pouze čas hry a nemá přístup do galerie ani k ovládání hry.

Vercel při instalaci spouští `postinstall`, který generuje Prisma Client. Build příkaz jej generuje znovu, takže sestavení nezávisí na lokálně vygenerovaném klientovi.

## Lokální spuštění

Požadavky: Node.js 20.9 nebo novější, Firebase projekt, Neon databáze a Vercel Blob store/token.

1. Zkopírujte `.env.example` do `.env` a doplňte všechny hodnoty. Pro lokální vývoj doporučujeme samostatný Firebase projekt a Neon databázi.
2. Nainstalujte balíčky a aplikujte databázové migrace:

   ```powershell
   npm ci
   npm run db:deploy
   ```

3. Spusťte vývojový server:

   ```powershell
   npm run dev
   ```

4. Otevřete `http://localhost:3000`. Prohlížečový Firebase config musí patřit Firebase projektu s povolenou doménou `localhost`.

Firebase Admin SDK vyžaduje service account i při lokálním vývoji. Pro testovacího administrátora vytvořte Firebase uživatele a jeho UID vložte do `FIREBASE_ADMIN_UID`.

## Databáze a změny schématu

Schéma je definované v `prisma/schema.prisma`; SQL změny se ukládají pod `prisma/migrations/`.

- `GameState` uchovává kompletní herní stav jako JSONB v jediném řádku. Verze řádku a compare-and-set opakování chrání souběžné změny před přepsáním.
- `AuthSession` uchovává hash Firebase session cookie, UID, roli, případné ID týmu a expiraci. Původní cookie token se do databáze neukládá.
- `LoginThrottle` počítá neúspěšná týmová přihlášení a omezuje opakované pokusy.

Při změně Prisma modelů vytvořte a zkontrolujte novou migraci:

```powershell
npm run db:migrate -- --name popis-zmeny
```

Příkaz `db:migrate` používejte v lokálním vývoji, kde může Prisma migraci vytvořit. Před nasazením zkontrolujte vygenerované SQL a změnu commitněte. Na Vercelu se již připravené migrace aplikují příkazem `npm run db:deploy`; na produkční databázi nepoužívejte `prisma migrate dev`.

## Přihlášení a oprávnění

- Administrátorská role se přiděluje pouze Firebase UID z `FIREBASE_ADMIN_UID`.
- Týmové přihlašovací údaje se ověřují proti scrypt hashi uloženému v herním stavu; po úspěšném ověření server vydá Firebase custom token s ID týmu.
- Server vytvoří Firebase session cookie s platností 14 dní. Její hash a oprávnění jsou evidované v `auth_sessions`; odhlášení záznam zneplatní a API ověřuje Firebase cookie při požadavcích.
- Neúspěšná týmová přihlášení se omezují podle kombinace názvu týmu a klientské adresy. Po 10 neúspěšných pokusech v 15 minutách server vrací HTTP 429 s hlavičkou `Retry-After`.
- API filtruje týmová data a skrytý obsah stanovišť; herní akce a administrátorská rozhodnutí ověřuje server. Firebase UID samo o sobě nedává administrátorská oprávnění.

## Data ze starší verze

Starší soubory `data/game.db` a `data/game-media/` se do PostgreSQL a Blobu nepřenášejí automaticky. Před spuštěním ostré hry rozhodněte, zda provedete samostatný import, nebo začnete novou hru. Původní lokální databázi a média nemažte, dokud neověříte případnou zálohu a přenos.

## Kontrola nasazení a řešení potíží

Před odevzdáním změn spusťte:

```powershell
npm run lint
npm run build
```

| Problém | Zkontrolujte |
| --- | --- |
| Chyba připojení k databázi | `DATABASE_URL` obsahuje Neon pooled adresu a `DIRECT_URL` přímou adresu; heslo ani query parametry nebyly zkráceny. |
| Migrace selže ve Vercelu | `DIRECT_URL` je nastavené pro prostředí deploymentu a Build Command začíná `npm run db:deploy`. |
| Prisma hlásí chybějící model nebo tabulku | Spusťte `npm run db:deploy` a zkontrolujte log migrací. |
| Firebase hlásí nepovolenou doménu | Přidejte doménu přesně do Firebase **Authorized domains**. |
| Tým se nepřihlásí přes Firebase | Ověřte Firebase Admin service account, `FIREBASE_ADMIN_PROJECT_ID` a že tým existuje v herním stavu. |
| Firebase účet se nemůže přihlásit jako administrátor | Ověřte e-mail/heslo provider a shodu Firebase UID s `FIREBASE_ADMIN_UID`. |
| QR skener nevidí kameru | Aplikace požádá o přístup ke kameře po přihlášení týmu. Povolte webu přístup v dialogu prohlížeče. Skener používá zadní kameru přímo v aplikaci. Pokud byl přístup zamítnut, změňte oprávnění kamery v nastavení webu; skenování vyžaduje HTTPS nebo `localhost`. |
| Nahrávání souboru selže | Ověřte Blob store, `BLOB_READ_WRITE_TOKEN`, oprávnění prostředí a povolený typ souboru do 50 MB. |
| Chyba Firebase private key | Zkontrolujte kompletní JSON service accountu a nové řádky `\n` v `FIREBASE_ADMIN_PRIVATE_KEY`. |

Herní stav zálohujte v Neonu; média zálohujte nebo retenčně spravujte v Blob store. Odstranění Blob store nebo ztráta jeho tokenu přeruší přehrávání uložených médií.

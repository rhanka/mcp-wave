# WP-CLAUDE-01 - Spike de faisabilite distribution Claude.ai

Date: 2026-05-19
Auteur: agent Claude (spike)
Statut: termine, decision recommandee ci-dessous
Portee: produit grand public `claude.ai` (et clients Claude associes), pas l'API Anthropic.

## Question 1 - Support MCP distant dans Claude.ai grand public

**Oui, disponible sur tous les plans, avec UI dediee.**

- Un utilisateur final peut ajouter un MCP distant personnalise via
  `Customize > Connectors > Add custom connector` sur Free, Pro, Max, Team et
  Enterprise. Source: Claude Help Center, `support.claude.com/.../11175166`,
  consulte le 2026-05-19.
- Limites de plan documentees: Free est plafonne a **1 connecteur custom**.
  Source: idem.
- Sur Team et Enterprise, seul un **Owner** peut ajouter le connecteur
  d'organisation; les membres se connectent ensuite individuellement.
  Source: idem.
- Contraintes techniques officielles:
  - Le serveur MCP doit etre **accessible depuis l'internet public**, depuis
    les plages d'IP Anthropic. Pas de VPN, pas de reseau prive.
    Source: `support.claude.com/.../11175166`.
  - Transport recommande: **Streamable HTTP** (la politique du Directory exige
    le support de Streamable HTTP).
    Source: Anthropic Software Directory Policy,
    `support.claude.com/.../13145358`.
  - HTTPS implicite (callback OAuth Anthropic est en `https://`).
- Cout: aucune mention de tarif specifique a l'ajout d'un connecteur custom.
  L'utilisation est incluse dans le plan Claude existant.

## Question 2 - Stockage des secrets par utilisateur et flux OAuth

**OAuth 2.x est le seul schema d'auth supporte cote Claude.ai aujourd'hui.
Anthropic gere le stockage du token cote serveur, par utilisateur.**

- Bearer token statique colle par l'utilisateur: **non supporte** dans
  Claude.ai. La doc officielle d'auth indique explicitement
  `User-pasted bearer tokens (static_bearer) are not yet supported`.
  Source: `claude.com/docs/connectors/building/authentication`, consulte le
  2026-05-19.
- Schemas recommandes par Anthropic pour un MCP distant grand public:
  - OAuth 2.0 avec **Dynamic Client Registration (DCR)**, ou
  - **Client ID Metadata Document (CIMD)**, ou
  - `oauth_anthropic_creds` (identifiants client detenus par Anthropic).
  - PKCE `S256` est inclus systematiquement par Claude.
  - Pour les serveurs a fort trafic, Anthropic recommande CIMD ou
    `oauth_anthropic_creds` plutot que DCR.
  Source: idem.
- Flux client credentials pur (M2M sans interaction utilisateur): **interdit**
  par la Directory Policy. Chaque utilisateur doit passer par un consentement
  interactif.
  Source: Anthropic Software Directory Policy,
  `support.claude.com/.../13145358`.
- URLs de callback OAuth a whitelister cote serveur Wave/MCP-wave:
  - `https://claude.ai/api/mcp/auth_callback`
  - `https://claude.com/api/mcp/auth_callback`
- Stockage du token: cote Anthropic. Apres consentement, le token d'acces
  utilisateur est conserve cote serveur Anthropic et utilise pour signer les
  appels MCP suivants. L'operateur (`mcp-wave`) ne touche pas le token. La
  doc precise: `Anthropic uses the stored client credentials to complete the
  token exchange on the user's behalf`.
  Source: `claude.com/docs/connectors/building/authentication`.
- Bug a connaitre, encore ouvert au 2026-05-19: sur certains serveurs MCP,
  le flux OAuth complete avec succes mais Claude.ai n'envoie ensuite pas le
  header `Authorization: Bearer` sur les appels MCP. Le meme serveur fonctionne
  via Claude Code CLI. Sources:
  `github.com/anthropics/claude-code/issues/46140`,
  `github.com/modelcontextprotocol/modelcontextprotocol/issues/2157`,
  consultes le 2026-05-19. A surveiller pour `mcp-wave` qui devra demarrer
  l'integration sur ce flux.
- Consequence pour Wave: il faut soit implementer un provider OAuth 2.1
  (avec DCR ou CIMD) cote `mcp-wave` qui fait lui-meme le pont vers
  l'authentification Wave, soit s'appuyer sur Wave OAuth si `WP-MCP-05`
  confirme qu'il est utilisable.

## Question 3 - Catalogue / Connectors Directory / store

**Oui, un catalogue officiel existe et la soumission est ouverte mais
gardee par une revue manuelle Anthropic.**

- Catalogue officiel: `claude.ai/directory` (Connectors Directory).
  Source: `claude.com/docs/connectors/directory`, consulte le 2026-05-19.
- Au 2026-03-31, Anthropic a unifie Skills, Connectors et Plugins dans un
  Directory unique a `claude.ai/directory`. Volume cite au 2026-05-15: ~398
  integrations verifiees sur 30 categories. Source: idem.
- Soumission:
  - Formulaire remote MCP: `https://clau.de/mcp-directory-submission`.
  - Formulaire desktop extensions: `https://clau.de/desktop-extention-submission`.
  - Page d'entree: `claude.com/connectors`, lien `Get started` vers le Google
    Form.
  Source: `claude.com/docs/connectors/building/submission`.
- Exigences techniques explicites pour passer la revue:
  - OAuth 2.0 obligatoire si le service distant requiert auth. Pas de bearer
    statique. Pas de client credentials pur.
  - HTTPS + certificat reconnu.
  - Validation `Origin` header.
  - Annotations sur **chaque tool**: `readOnlyHint` pour read/search/list/get,
    `destructiveHint` pour create/update/delete/send, plus `title`. 30% des
    rejets sont sur les annotations manquantes.
  - Streamable HTTP supporte cote serveur.
  - Privacy Policy publique obligatoire, sinon rejet immediat.
  - Compte de test fourni a Anthropic avec donnees representatives.
  - Minimum 3 prompts/use cases qui demontrent les fonctions.
  - Whitelist obligatoire des callbacks `claude.ai` et `claude.com`.
  Sources: `claude.com/docs/connectors/building/submission`,
  `support.claude.com/.../13145358`.
- Cas d'usage **interdits** par la Directory Policy:
  - Transactions financieres et transferts d'actifs.
  - Images, video, audio generes par IA (sauf outils de design).
  - Vehicules publicitaires ou promotionnels.
  Source: `support.claude.com/.../13145358`.
  > Point d'attention pour `mcp-wave`: la formulation `Financial transactions
  > or asset transfers` cible vraisemblablement les rampes paiement/crypto et
  > non la comptabilite SaaS. Mais il faut interroger explicitement Anthropic
  > avant soumission, car `mcp-wave` cree des entries comptables
  > (`split_payroll_remittance`, `mark_invoice_paid`) qui peuvent etre lues
  > litteralement comme `financial transactions`. Inconnu a ce stade.
- Cout de soumission: **gratuit**, aucun frais ni revenue share mentionne.
- Delai de revue: **environ 2 semaines** selon les sources tierces, mais
  Anthropic ne garantit pas de SLA (`Review times vary with queue volume`).
- Revue continue: Anthropic effectue des revues initiales **et continues**;
  un connecteur peut etre retire du Directory en cas de non-conformite.

## Question 4 - Lien d'installation "one-click"

**Oui, un schema d'URL pre-remplit la modale "Add custom connector".**

- Format officiel:
  `https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=NAME&connectorUrl=ENCODED_URL`
  Source: `claude.com/docs/connectors/building/directory-vs-custom`, consulte
  le 2026-05-19.
- Parametres:
  - `modal=add-custom-connector`
  - `connectorName` (texte affiche)
  - `connectorUrl` (URL du serveur MCP, percent-encoded)
- Comportement:
  - L'utilisateur arrive sur la modale **deja pre-remplie** avec un bandeau
    indiquant que les valeurs proviennent d'un lien externe.
  - L'utilisateur doit confirmer; rien n'est ajoute automatiquement.
  - Si l'utilisateur n'est pas connecte, il est invite a se connecter d'abord
    puis ramene sur la modale pre-remplie.
- Limites:
  - Le lien ne contourne aucune permission ni revue utilisateur.
  - Les connecteurs custom ne sont **jamais** suggeres in-chat par Claude,
    contrairement aux connecteurs du Directory.
- Disponibilite par plan: la doc ne le precise pas explicitement, mais la
  modale `add-custom-connector` est la meme que celle exposee a tous les plans
  payants et au Free (avec sa limite a 1). Donc le deep link est utilisable
  pour tous les plans qui ont la modale.

## Recommandation

Recommandation: **option A (cibler le Directory) + option B (deep link manuel)
en parallele, conserver option C en filet de securite.**

Justification:
1. Option C seule sous-utilise un canal de distribution gratuit qui existe
   formellement et qui apporte de la decouvrabilite. `mcp-wave` a deja un
   profil compatible (read/write comptable explicite, surface de 26 tools).
2. Option B est trivialement realisable des aujourd'hui: le deep link
   `claude.ai/customize/connectors?modal=add-custom-connector&...` permet de
   livrer un bouton "Connecter Wave a Claude" dans la console Track 2 sans
   attendre la revue Directory. Cela debloque l'enrolement utilisateur sans
   dependance Anthropic.
3. Option A (Directory) est l'objectif a viser, mais conditionnel a:
   - implementer OAuth 2.1 (DCR ou CIMD) cote `mcp-wave` (depend de
     `WP-MCP-05`),
   - completer les annotations `readOnlyHint`/`destructiveHint`/`title` sur
     les 26 tools,
   - publier une privacy policy et fournir un compte de test,
   - obtenir confirmation Anthropic que la comptabilite SaaS n'est pas
     classifiee comme `Financial transactions` interdites.
4. Sequencage propose: livrer B immediatement (`WP-CLAUDE-03` mis a jour pour
   inclure le deep link), preparer A en arriere-plan (`WP-CLAUDE-02`), ne
   soumettre au Directory qu'apres `WP-MCP-05` et apres alignement Anthropic
   sur la policy `Financial transactions`.

## Inconnues explicites au 2026-05-19

- Statut exact de la clause `Financial transactions or asset transfers` de la
  Directory Policy applique a un connecteur comptable. A clarifier par mail
  `mcp-review@anthropic.com` avant soumission.
- Bug Claude.ai OAuth ou le `Authorization: Bearer` n'est pas reemis apres
  consentement: encore ouvert sur les depots GitHub Anthropic au moment de la
  consultation. Impact potentiel sur l'experience utilisateur reelle a tester
  en pre-prod.
- Cout: aucune source primaire ne mentionne de frais de soumission ou de
  revenue share; considere comme gratuit jusqu'a preuve du contraire.

## Sources

- [Claude Help Center - Get started with custom connectors using remote MCP](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) - consulte 2026-05-19
- [Claude Help Center - Build custom connectors via remote MCP servers](https://support.claude.com/en/articles/11503834-build-custom-connectors-via-remote-mcp-servers) - consulte 2026-05-19
- [Claude Help Center - Use connectors to extend Claude's capabilities](https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities) - consulte 2026-05-19
- [Claude Help Center - Anthropic Software Directory Policy](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy) - consulte 2026-05-19
- [Claude.ai Docs - Connectors Directory](https://claude.com/docs/connectors/directory) - consulte 2026-05-19
- [Claude.ai Docs - Submitting to the Connectors Directory](https://claude.com/docs/connectors/building/submission) - consulte 2026-05-19
- [Claude.ai Docs - Authentication for connectors](https://claude.com/docs/connectors/building/authentication) - consulte 2026-05-19
- [Claude.ai Docs - Directory connectors vs custom connectors](https://claude.com/docs/connectors/building/directory-vs-custom) - consulte 2026-05-19
- [Claude.ai Docs - Third party connectors with remote MCP](https://claude.com/docs/connectors/custom/remote-mcp) - consulte 2026-05-19
- [claude.com/connectors - landing page Directory + lien Google Form de soumission](https://claude.com/connectors) - consulte 2026-05-19
- [GitHub anthropics/claude-code issue #46140 - OAuth bearer non envoye par Claude.ai](https://github.com/anthropics/claude-code/issues/46140) - consulte 2026-05-19
- [GitHub modelcontextprotocol issue #2157 - meme bug, suivi MCP](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/2157) - consulte 2026-05-19
- [GitHub anthropics/claude-ai-mcp issue #112 - pas de bearer token dans la modale custom](https://github.com/anthropics/claude-ai-mcp/issues/112) - consulte 2026-05-19

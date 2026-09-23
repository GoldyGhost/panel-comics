# PANEL — procédure de déploiement et de gestion

Trois fichiers font tourner l'app :
- `index.html` — le **front** (tout le JS/CSS est dedans, pas de build à faire)
- `config.js` — l'endroit où tu colles les identifiants de ta base
- `supabase/schema.sql` — le **back** : tables, sécurité, données de départ

Aucun serveur à faire tourner toi-même : Supabase joue le rôle de backend (base
Postgres + authentification + API), et le front est un site 100% statique.

---

## 0. Ce qu'il faut installer sur ta machine

| Outil | Pourquoi | Obligatoire ? |
|---|---|---|
| [Git](https://git-scm.com/downloads) | Versionner et envoyer le code sur GitHub | Oui |
| Un éditeur de code (ex. [VS Code](https://code.visualstudio.com/)) | Modifier `index.html` / `config.js` | Oui |
| Un compte [GitHub](https://github.com) | Héberger le code source | Oui |
| Un compte [Supabase](https://supabase.com) | Base de données + authentification | Oui |
| Un compte [Vercel](https://vercel.com) | Héberger le site | Oui |
| [Node.js](https://nodejs.org) | Seulement si tu veux un serveur local de test (`npx serve`) | Optionnel |
| Un client Postgres graphique ([TablePlus](https://tableplus.com), [DBeaver](https://dbeaver.io), gratuit) | Consulter/modifier la BDD sans passer par le site Supabase | Optionnel |
| [Supabase CLI](https://supabase.com/docs/guides/cli) | Gérer les migrations SQL en ligne de commande, plus tard si le projet grossit | Optionnel |

Tu n'as **pas besoin d'installer Postgres toi-même** : Supabase l'héberge pour toi.
Un client graphique n'est utile que si tu préfères une interface de bureau à
celle du navigateur.

---

## 1. Créer le projet Supabase (la base de données)

1. Va sur [supabase.com](https://supabase.com) → **Start your project** → connecte-toi avec GitHub.
2. **New project** : donne-lui un nom (`panel-comics`), choisis un mot de passe pour la base (à conserver), choisis une région proche de toi.
3. Attends ~2 minutes que le projet soit prêt.

## 2. Charger le schéma dans la base

1. Dans le menu de gauche de Supabase : **SQL Editor** → **New query**.
2. Ouvre le fichier `supabase/schema.sql` fourni, copie tout son contenu, colle-le dans l'éditeur.
3. Clique **Run**. Tu dois voir "Success" et ~108 lignes insérées dans `issues`.

Ça crée :
- `issues` : catalogue des numéros, **lisible par tout le monde**, modifiable seulement par les comptes connectés (règles RLS incluses).
- `logs` : tes lectures loguées, **visibles seulement par leur propriétaire** (RLS aussi).

## 3. Configurer l'authentification

Par défaut Supabase exige une confirmation par email à l'inscription.
Pour un usage perso/test rapide, tu peux la désactiver :

1. **Authentication** → **Providers** → **Email**.
2. Décoche **Confirm email**.
3. Sauvegarde.

(Tu peux la remettre plus tard si tu ouvres l'app à d'autres personnes.)

## 4. Récupérer tes clés et configurer l'app

1. **Project Settings** (icône engrenage) → **API**.
2. Copie **Project URL** et la clé **anon public**.
3. Ouvre `config.js` et remplace les deux valeurs :

```js
window.PANEL_CONFIG = {
  SUPABASE_URL: "https://xxxxxxxx.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOi...",
};
```

La clé `anon` est **faite pour être publique** (elle finira dans le code du
site, visible de tous) — c'est normal et sans danger : ce sont les règles RLS
définies à l'étape 2 qui protègent réellement les données, pas le secret de
cette clé.

## 5. Tester en local (optionnel mais recommandé)

Comme le fichier utilise `fetch` vers Supabase, ouvrir `index.html` directement
au double-clic fonctionne dans la plupart des navigateurs modernes. Si tu as
un souci (page blanche, erreurs CORS), lance un petit serveur local :

```bash
npx serve .
# ou : python3 -m http.server 8080
```

puis ouvre `http://localhost:8080`.

## 6. Mettre le code sur GitHub

```bash
cd comics-log
git init
git add .
git commit -m "Premier commit"
```

Crée un nouveau repo sur [github.com/new](https://github.com/new) (public ou
privé, peu importe), puis :

```bash
git remote add origin https://github.com/TON-COMPTE/panel-comics.git
git branch -M main
git push -u origin main
```

## 7. Déployer sur Vercel

1. Sur [vercel.com](https://vercel.com), connecte-toi avec GitHub.
2. **Add New… → Project**, choisis le repo `panel-comics`.
3. Vercel détecte un site statique : laisse **Framework Preset** sur "Other",
   pas de build command nécessaire.
4. **Deploy**. Après ~30 secondes tu as une URL du type
   `panel-comics.vercel.app`, déjà en HTTPS.

À chaque `git push` sur `main`, Vercel redéploie automatiquement.

## 8. (Optionnel) Nom de domaine personnel

Dans le projet Vercel → **Settings → Domains**, ajoute ton domaine acheté
chez un registrar (Namecheap, OVH, Google Domains…) et suis les instructions
DNS affichées (en général un enregistrement `CNAME`). Compte ~10 €/an pour
le nom de domaine ; l'hébergement Vercel reste gratuit sur ce plan.

---

## Gérer le projet au quotidien

**Accéder et modifier le code (front + "back")**
- Le "back" ici n'est pas un serveur à administrer : c'est le fichier
  `supabase/schema.sql` (structure) + le dashboard Supabase (données, règles,
  utilisateurs).
- Le front est `index.html` + `config.js`, à modifier avec ton éditeur de
  code, puis :
  ```bash
  git add .
  git commit -m "Description du changement"
  git push
  ```
  Vercel redéploie tout seul en quelques secondes.

**Gérer la base de données**
- **Table Editor** (dans Supabase) : voir/éditer les lignes comme dans un
  tableur, sans SQL.
- **SQL Editor** : pour des requêtes ou modifications de schéma plus poussées
  (ex. ajouter une colonne).
- **Client de bureau (TablePlus/DBeaver)** si tu préfères : dans **Project
  Settings → Database**, copie la "Connection string" et colle-la dans le
  client. Tu retrouves alors tes tables comme dans n'importe quel Postgres.

**Gérer les comptes utilisateurs**
- **Authentication → Users** dans Supabase : liste des comptes, possibilité
  de bloquer ou supprimer un utilisateur.

**Sauvegarder / exporter les données**
- Le plan gratuit Supabase garde une copie de la base, mais sans sauvegardes
  automatiques historisées. Pour un export ponctuel : **Database → Backups**
  (sur les plans payants) ou simplement `pg_dump` via la chaîne de connexion
  si tu veux un export manuel.

---

## Coût réel de cette configuration

| Service | Usage | Prix |
|---|---|---|
| Vercel (Hobby) | Hébergement du front | 0 € |
| Supabase (Free) | BDD + Auth + API, jusqu'à 500 Mo | 0 € |
| Nom de domaine (optionnel) | `tonapp.com` | ~10 €/an |

Le plan gratuit Supabase met le projet en pause après 7 jours sans requête ;
une simple visite du site le réveille en quelques secondes. Si ça te gêne
(usage régulier par plusieurs personnes), le palier suivant est **Supabase
Pro à 25 $/mois**.

---

## Dépannage courant

- **Page blanche + bandeau rouge "Configuration manquante"** → `config.js`
  n'a pas été rempli avec tes vraies valeurs (étape 4).
- **Erreur au login "Email not confirmed"** → active/désactive la
  confirmation email selon ce que tu veux (étape 3), ou clique le lien reçu
  par mail.
- **Une requête renvoie une liste vide alors que des données existent** →
  vérifie les règles RLS dans **Authentication → Policies** : c'est souvent
  une policy manquante ou une faute dans `auth.uid() = user_id`.
- **"Failed to fetch" dans la console** → vérifie que `SUPABASE_URL` est
  exactement celle de ton projet (pas d'espace, pas de `/` final en trop).

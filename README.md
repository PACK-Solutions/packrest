# packrest

Client web façon Postman pour utilisateurs non-développeurs. L'app charge les
contrats OpenAPI de Pack Solutions et permet d'exécuter chaque endpoint depuis
le navigateur : choix de l'API → choix de l'endpoint → formulaire pré-rempli à
partir des `examples` du contrat → obtention d'un token OAuth2 → exécution →
panneau de réponse.

## Démarrage

```bash
npm install
npm run dev      # http://localhost:3001
```

Au premier lancement, aucune API n'apparaît tant que les specs n'ont pas été
synchronisées (voir ci-dessous).

## Sources des specs OpenAPI

Les contrats sont copiés dans `public/specs/<api>.yaml`. Deux sources, au
choix, disponibles dans **Paramètres** :

1. **Dossier local** — un répertoire contenant `<api>/v1/openapi.bundle.yaml`
   (utile en développement). Voir `CLAUDE.md` pour l'ordre de résolution.
2. **Release GitLab** — télécharge le `bundle.zip` d'une release du projet
   [`packsolutions/openapi`](https://gitlab.com/packsolutions/openapi/-/releases)
   et en extrait les contrats. **C'est la source recommandée.**

## Configurer le token GitLab

La synchro depuis une release GitLab nécessite un token d'accès, car le projet
`packsolutions/openapi` est privé. Le téléchargement se fait **côté serveur** :
le token est stocké dans `.packrest.config.json` (à la racine, gitignoré) et
n'est **jamais** renvoyé au navigateur.

### 1. Créer le token

Deux types de tokens conviennent. Dans les deux cas, le **scope `read_api`**
suffit (lecture seule — pas besoin de `api`, `write_*`, etc.).

**Option A — Project Access Token (recommandé, le plus restreint)**

Limité au seul projet `openapi`. Nécessite d'être *Maintainer* ou *Owner* du
projet.

1. Aller sur le projet : **`openapi` → Settings → Access Tokens**.
2. Renseigner :
   - **Role** : `Reporter`
   - **Scopes** : cocher `read_api`
   - **Expiration** : une date raisonnable
3. **Create** puis copier le token (affiché une seule fois, format `glpat-…`).

**Option B — Personal Access Token (repli universel)**

Fonctionne tant que votre compte a au moins le rôle *Reporter* sur le projet.
Plus large : couvre tous vos projets accessibles.

1. **Avatar → Edit profile → Access Tokens** (User Settings → Access Tokens).
2. Cocher le scope `read_api`, choisir une expiration, **Create**.
3. Copier le token (`glpat-…`).

### 2. Enregistrer le token dans packrest

1. Lancer l'app (`npm run dev`) et ouvrir **Paramètres**
   (`http://localhost:3001/settings`).
2. Carte **« Synchroniser depuis une release GitLab »** :
   - **Projet GitLab** : `packsolutions/openapi` (valeur par défaut).
   - **Token d'accès** : coller le token.
3. Cliquer **« Enregistrer la connexion »**.

Le token est écrit côté serveur dans `.packrest.config.json` :

```json
{
  "gitlab": {
    "host": "https://gitlab.com",
    "projectPath": "packsolutions/openapi",
    "token": "glpat-…"
  }
}
```

> Le champ token reste masqué ensuite : laissez-le vide pour conserver le token
> déjà enregistré, ou saisissez-en un nouveau pour le remplacer. Vous pouvez
> aussi éditer `.packrest.config.json` directement.

### 3. Synchroniser

1. Une fois le token enregistré, les **3 dernières releases** sont chargées
   automatiquement (les releases sans `bundle.zip` apparaissent désactivées).
   **« Charger toutes les releases »** affiche la liste complète, et
   **« Rafraîchir »** la recharge.
2. Choisir un tag puis **« Synchroniser ce tag »**.

Les contrats sont extraits dans `public/specs/` et le cache est rafraîchi sans
redémarrage : les APIs apparaissent immédiatement.

### Sécurité

- Le token vit uniquement côté serveur, dans un fichier **gitignoré**. Ne le
  commitez pas et ne le collez pas dans un canal partagé.
- Utilisez `read_api` et la date d'expiration la plus courte possible.
- En cas de fuite, révoquez-le (projet/profil → Access Tokens → *Revoke*) et
  régénérez-en un.

## Commandes

```bash
npm run dev          # serveur de dev (port 3001)
npm run build        # build de production
npm run sync-specs   # re-copie depuis le dossier local (sans redémarrer)
npm run typecheck    # tsc --noEmit (seul contrôle automatisé)
```

# Prix Pump

Prototype d'un comparateur de prix de carburants avec géolocalisation. Les prix affichés sont **simulés** — l'étape suivante est de les remplacer par les vraies données ouvertes du gouvernement français.

## Lancer le projet en local

Prérequis : avoir [Node.js](https://nodejs.org) installé (version 18 ou plus récente).

```bash
npm install
npm run dev
```

Le site s'ouvre sur `http://localhost:5173`. Une fois en local (et surtout une fois en ligne), le bouton "Trouver les stations autour de moi" fonctionnera normalement — ton navigateur demandera l'autorisation d'accéder à ta position.

## Mettre le site en ligne (gratuit, avec Vercel)

1. Crée un compte gratuit sur [vercel.com](https://vercel.com) (tu peux te connecter avec GitHub)
2. Crée un compte gratuit sur [github.com](https://github.com) si tu n'en as pas
3. Mets ce dossier de projet dans un nouveau dépôt GitHub :
   ```bash
   git init
   git add .
   git commit -m "Premier commit Prix Pump"
   ```
   Puis crée un nouveau dépôt sur GitHub et suis les instructions qu'il affiche pour pousser ton code (`git remote add origin ...` puis `git push`)
4. Sur Vercel, clique sur "Add New Project", choisis ton dépôt GitHub "prixpump"
5. Vercel détecte automatiquement que c'est un projet Vite — laisse les réglages par défaut et clique sur "Deploy"
6. En 1-2 minutes, ton site est en ligne avec une adresse du type `prixpump.vercel.app`

**Important pour la géolocalisation** : elle ne fonctionne que sur une adresse en HTTPS (ce que Vercel fournit automatiquement) — pas besoin de configuration supplémentaire de ta part.

## Connecter ton propre nom de domaine

Une fois le domaine acheté (Gandi, OVH...) :
1. Dans ton projet Vercel, va dans **Settings > Domains**
2. Ajoute ton nom de domaine (ex: `prixpump.fr`)
3. Vercel te donne des enregistrements DNS à copier chez ton registrar — c'est un simple copier-coller dans leur interface
4. Le certificat HTTPS se configure automatiquement

## Prochaines étapes

- Remplacer les prix simulés (`buildStations` dans `src/App.jsx`) par les vraies données de l'API officielle : https://www.data.gouv.fr/reuses/api-prix-carburants
- Remplacer les badges d'enseignes stylisés par les vrais logos, si tu les récupères sur les pages presse officielles de chaque marque
- Réfléchir à la monétisation (pub, version premium) une fois le site en ligne

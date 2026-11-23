# Google Localiser mon appareil

## Présentation

Cette intégration amène dans Gladys les appareils de votre compte Google **Localiser mon
appareil** (Find Hub) : téléphones et tablettes Android, et traceurs Bluetooth du réseau Find Hub
(Chipolo, Pebblebee, Moto Tag, écouteurs…).

Pour chaque appareil, Gladys reçoit :

- **Position** : le nom du lieu ou les coordonnées de la dernière position ;
- **À la maison** : 1 quand l'appareil est dans le rayon de la maison, 0 sinon ;
- **Distance de la maison** (km) et **Précision de la position** (m) ;
- **Sonner** : un interrupteur qui fait sonner l'appareil à plein volume, même en mode silencieux.

Elle ajoute aussi :

- trois **déclencheurs de scène** : _Un appareil a une nouvelle position_, _Un appareil arrive à la
  maison_, _Un appareil quitte la maison_ (avec en variables le nom de l'appareil, les coordonnées,
  la distance et un lien Google Maps) ;
- trois **actions de scène** : _Localiser un appareil_ (renvoie la position), _Faire sonner un
  appareil_, _Arrêter la sonnerie d'un appareil_ ;
- un **widget de tableau de bord** qui liste vos appareils, avec les boutons Localiser et Sonner.

Les positions sont chiffrées de bout en bout par Google : l'intégration les déchiffre dans votre
Gladys, avec vos propres clés. Elles ne partent nulle part ailleurs.

## Prérequis

Google ne propose **aucune API publique** pour Localiser mon appareil. Cette intégration utilise
la même API privée que l'application Localiser mon appareil, telle que décrite par le projet libre
[GoogleFindMyTools](https://github.com/leonboe1/GoogleFindMyTools). Google peut la changer à tout
moment.

La connexion demande une vraie fenêtre Chrome : elle se fait **une seule fois, sur un
ordinateur** :

1. Installez Python 3 et Google Chrome sur un ordinateur.
2. Téléchargez GoogleFindMyTools, puis dans son dossier lancez `pip install -r requirements.txt`
   et `python main.py`.
3. Connectez-vous à votre compte Google dans la fenêtre Chrome qui s'ouvre.
4. Quand la liste des appareils s'affiche, **choisissez un appareil à localiser** : l'outil demande
   le code de verrouillage (ou le schéma) d'un de vos appareils Android. Cela débloque la clé de
   chiffrement de vos positions (`owner_key`). Sans cette étape, les positions ne peuvent pas être
   déchiffrées.
5. L'outil écrit le fichier `Auth/secrets.json`. Ouvrez-le avec un éditeur de texte et copiez
   **tout** son contenu.

Votre maison Gladys doit avoir une position (Paramètres → Maisons) pour la présence et la
distance.

## Configuration

1. Dans Gladys, installez l'intégration, puis ouvrez son onglet **Configuration**.
2. Collez le contenu de `secrets.json` dans **Contenu de secrets.json** et enregistrez.
3. Facultatif : choisissez la **Maison**, le **Rayon de la maison** (150 m par défaut) et la
   fréquence **Localiser toutes les** (15 minutes par défaut, `0` = uniquement à la demande).
   Chaque demande réveille les appareils : un intervalle très court coûte de la batterie.
4. Cliquez sur **Tester la connexion** : elle affiche le compte, le nombre d'appareils et l'état du
   canal push.
5. Allez dans l'onglet **Appareils** et ajoutez ceux que vous voulez.

`secrets.json` donne accès aux appareils de votre compte Google : gardez-le privé. Il est stocké
dans un champ secret de Gladys (masqué dans l'interface) et n'est jamais écrit dans les logs. Utilisez un
`secrets.json` dédié à Gladys : si le même fichier tourne ailleurs (Home Assistant…), les deux se
disputent le même canal push.

## Dépannage

- **« secrets.json est incomplet »** : relancez GoogleFindMyTools jusqu'à ce qu'il liste vos
  appareils, puis collez le nouveau fichier.
- **« Les positions ne peuvent pas être déchiffrées : secrets.json n'a pas d'owner_key »** : dans
  GoogleFindMyTools, localisez un appareil (étape 4 ci-dessus), puis collez le fichier mis à jour.
- **« Google a refusé le jeton du compte (BadAuthentication) »** : le jeton a été révoqué
  (changement de mot de passe, contrôle de sécurité du compte). Supprimez `Auth/secrets.json`,
  relancez GoogleFindMyTools et collez le nouveau fichier.
- **Un appareil ne répond jamais** : il doit être allumé, en ligne, avec Localiser mon appareil
  activé. Un traceur n'est localisé que quand un téléphone Android passe à côté.
- **Badge « Canal push coupé »** : Gladys ne joint pas `mtalk.google.com` sur le port 5228 (TCP).
  Ouvrez ce port sortant sur votre pare-feu.
- **Ni présence ni distance** : donnez une position à votre maison Gladys, ou choisissez-la dans
  **Maison**.

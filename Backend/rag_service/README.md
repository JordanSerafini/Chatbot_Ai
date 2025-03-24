<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>


  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://coveralls.io/github/nestjs/nest?branch=master" target="_blank"><img src="https://coveralls.io/repos/github/nestjs/nest/badge.svg?branch=master#9" alt="Coverage" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

# Service RAG (Retrieval-Augmented Generation)

Ce service fournit une API pour le stockage, la récupération et l'analyse de questions et requêtes SQL en utilisant ChromaDB comme base de données vectorielle.

## Description

Le service RAG permet de faire correspondre des questions en langage naturel avec des requêtes SQL existantes. Il utilise une approche de recherche sémantique pour trouver les questions similaires et retourner les requêtes SQL correspondantes.

## Technologies utilisées

- **NestJS**: Framework backend
- **ChromaDB**: Base de données vectorielle pour le stockage et la recherche de similarité
- **TypeScript**: Langage de programmation

## Prérequis

- Node.js v20+
- ChromaDB (accessible via Docker ou installation locale)
- Dépendance `chromadb-default-embed` pour les fonctions d'embedding

## Installation

```bash
# Installation des dépendances
npm install

# Installation de la dépendance requise pour ChromaDB
npm install chromadb-default-embed
```

## Services disponibles

### 1. ChromaService

Ce service gère l'interaction avec ChromaDB pour stocker et récupérer des questions.

#### Fonctionnalités principales

- Initialisation de la collection: Crée ou récupère une collection ChromaDB au démarrage
- Ajout de questions: Ajoute des questions avec leurs métadonnées (SQL et description)
- Recherche de questions similaires: Trouve les questions les plus proches sémantiquement
- Suppression de la collection: Réinitialise complètement la collection
- Comptage des éléments: Retourne le nombre d'éléments dans la collection

### 2. RagService

Service principal qui utilise ChromaDB pour implémenter des fonctionnalités de RAG.

#### Fonctionnalités principales

- Gestion des collections: Création, récupération et manipulation de collections ChromaDB
- Gestion des documents: Ajout, mise à jour et récupération de documents
- Recherche de similarité: Recherche de documents similaires à une requête
- Traitement des questions: Analyse des questions pour trouver des requêtes SQL correspondantes

### 3. SqlQueriesService

Ce service gère le chargement et la mise à jour des requêtes SQL depuis des fichiers JSON.

#### Fonctionnalités principales

- Chargement de requêtes: Charge les requêtes SQL depuis des fichiers JSON
- Vérification des mises à jour: Vérifie si les fichiers de requêtes ont été modifiés
- Réinitialisation de la collection: Recharge toutes les requêtes dans la collection

## Routes API

### Routes de gestion des collections

#### POST /rag/collection/:name

Crée une nouvelle collection avec le nom spécifié.

#### POST /rag/collection/:name/documents

Ajoute des documents à une collection existante.

**Corps de la requête:**

```json
{
  "documents": ["document1", "document2"]
}
```

#### POST /rag/collection/:name/upsert

Insère ou met à jour des documents dans une collection.

**Corps de la requête:**

```json
{
  "documents": ["document1", "document2"],
  "ids": ["id1", "id2"]
}
```

#### GET /rag/collection/:name/similar

Trouve des documents similaires à une requête donnée.

**Paramètres de requête:**

- `query`: La requête à utiliser pour la recherche
- `limit`: Le nombre maximum de résultats à retourner

#### GET /rag/collection/:name/check-prompt

Vérifie si un prompt similaire existe dans la collection.

**Paramètres de requête:**

- `prompt`: Le prompt à vérifier
- `threshold`: Le seuil de similarité (entre 0 et 1)

#### POST /rag/collection/:name/cleanup

Nettoie une collection en supprimant les documents invalides.

#### POST /rag/collection/:name/reset

Réinitialise complètement une collection.

### Routes de traitement des questions

#### POST /rag/question

Traite une question pour trouver une requête SQL correspondante.

**Corps de la requête:**

```json
{
  "question": "Affiche tous les clients actifs"
}
```

#### POST /rag/reload-sql-queries

Recharge toutes les requêtes SQL depuis les fichiers JSON.

#### POST /rag/reload-collection

Recharge une collection spécifique.

**Corps de la requête:**

```json
{
  "collection": "nom_de_la_collection"
}
```

#### POST /rag/similar

Trouve les questions similaires à une question donnée.

**Corps de la requête:**

```json
{
  "question": "Trouve tous les clients",
  "nResults": 5
}
```

## Format des fichiers de requêtes SQL

Les requêtes SQL sont stockées dans des fichiers JSON avec la structure suivante:

```json
{
  "queries": [
    {
      "id": "clients-1",
      "questions": [
        "Affiche tous les clients",
        "Liste des clients",
        "Montre-moi les clients"
      ],
      "sql": "SELECT * FROM clients",
      "description": "Requête pour lister tous les clients"
    }
  ]
}
```

## Configuration

Le service est configuré pour s'exécuter sur le port 3002 par défaut, mais peut être modifié via la variable d'environnement `PORT`.

La connexion à ChromaDB est définie par défaut sur `http://localhost:8000` mais peut être modifiée dans les services respectifs.

## Démarrage du service

```bash
# Installation des dépendances
npm install

# Démarrage en mode développement
npm run start:dev

# Démarrage en mode production
npm run start:prod
```

## Licence

Ce projet est sous licence MIT.

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

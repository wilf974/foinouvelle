/**
 * Serveur Node.js simple pour servir l'application Foi Nouvelle
 * Injecte les variables d'environnement dans index.html
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const querystring = require('querystring');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const Database = require('better-sqlite3');
require('dotenv').config();

const PORT = process.env.PORT || 2000;

// Fichiers pour stocker les versets
const VERSE_CACHE_FILE = path.join(__dirname, 'weekly-verse.json');
const VERSE_ARCHIVE_FILE = path.join(__dirname, 'verses-archive.json');

// Base de données SQLite côté serveur
const DB_FILE = path.join(__dirname, 'foi-nouvelle.db');
let db = null;

// Authentification admin
const ADMIN_USERNAME = 'administrateur';
const ADMIN_PASSWORD = '@dm1n1str@t3uR!';
const ADMIN_SESSIONS = new Map(); // Stockage des sessions actives (en production, utiliser Redis ou une DB)
const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 heures

/**
 * Initialise la base de données SQLite côté serveur
 */
function initDatabase() {
    try {
        db = new Database(DB_FILE);

        // Créer la table pour le compteur global d'acceptations
        db.exec(`
            CREATE TABLE IF NOT EXISTS acceptance_counter (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                count INTEGER DEFAULT 0
            )
        `);

        // Créer la table pour les témoignages côté serveur (pour l'admin)
        db.exec(`
            CREATE TABLE IF NOT EXISTS testimonials (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                story TEXT NOT NULL,
                userId TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                aiApproved INTEGER DEFAULT 0,
                adminApproved INTEGER DEFAULT 0
            )
        `);

        // Créer la table pour le contenu personnalisable du site
        db.exec(`
            CREATE TABLE IF NOT EXISTS site_content (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                section_key TEXT UNIQUE NOT NULL,
                content_json TEXT NOT NULL,
                language TEXT DEFAULT 'fr',
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Initialiser le compteur à 0 s'il n'existe pas
        const existing = db.prepare('SELECT count FROM acceptance_counter WHERE id = 1').get();
        if (!existing) {
            db.prepare('INSERT INTO acceptance_counter (id, count) VALUES (1, 0)').run();
        }

        console.log('✅ Base de données SQLite initialisée:', DB_FILE);
    } catch (error) {
        console.error('❌ Erreur lors de l\'initialisation de la base de données:', error);
        throw error;
    }
}

/**
 * Récupère le compteur global d'acceptations
 * @returns {number} Le nombre total d'acceptations
 */
function getAcceptanceCounter() {
    try {
        const result = db.prepare('SELECT count FROM acceptance_counter WHERE id = 1').get();
        return result ? result.count : 0;
    } catch (error) {
        console.error('Erreur lors de la récupération du compteur:', error);
        return 0;
    }
}

/**
 * Incrémente le compteur global d'acceptations
 * @returns {number} Le nouveau nombre total d'acceptations
 */
function incrementAcceptanceCounter() {
    try {
        db.prepare('UPDATE acceptance_counter SET count = count + 1 WHERE id = 1').run();
        return getAcceptanceCounter();
    } catch (error) {
        console.error('Erreur lors de l\'incrémentation du compteur:', error);
        return getAcceptanceCounter();
    }
}

// Initialiser la base de données au démarrage
initDatabase();

/**
 * Configuration du transporteur SMTP
 */
const transporter = nodemailer.createTransport({
    service: 'Gmail',
    auth: {
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASSWORD || ''
    }
});

/**
 * Vérifie la configuration SMTP au démarrage
 */
transporter.verify((error, success) => {
    if (error) {
        console.error('❌ Erreur de configuration SMTP:', error.message);
    } else {
        console.log('✅ Configuration SMTP prête à envoyer des emails');
    }
});

/**
 * Charge le verset hebdomadaire depuis le cache
 * @returns {Object} Objet contenant le verset, la référence et la date
 */
function loadWeeklyVerse() {
    try {
        if (fs.existsSync(VERSE_CACHE_FILE)) {
            const data = fs.readFileSync(VERSE_CACHE_FILE, 'utf8');

            // Vérifier que le fichier n'est pas vide
            if (!data || data.trim().length === 0) {
                console.log('⚠️ Fichier weekly-verse.json vide, génération d\'un nouveau verset...');
                return null; // Retourner null pour forcer la génération
            }

            const verse = JSON.parse(data);

            // Vérifier que le verset a les propriétés nécessaires
            if (!verse || !verse.dateISO || !verse.text || !verse.reference) {
                console.log('⚠️ Verset invalide dans le cache, génération d\'un nouveau verset...');
                return null;
            }

            // Vérifier si le verset est encore valide (pour la semaine en cours)
            const verseDate = new Date(verse.dateISO + 'T00:00:00');
            const now = new Date();

            // Calculer le début de la semaine actuelle (lundi)
            const dayOfWeek = now.getDay();
            const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
            const currentWeekStart = new Date(now);
            currentWeekStart.setDate(now.getDate() - daysToMonday);
            currentWeekStart.setHours(0, 0, 0, 0);

            // Si le verset est pour la semaine en cours, le retourner
            if (verseDate.getTime() === currentWeekStart.getTime()) {
                return verse;
            }
        }
    } catch (error) {
        console.error('Erreur lors du chargement du verset:', error);
        // Si le fichier est corrompu, le supprimer pour forcer la régénération
        try {
            if (fs.existsSync(VERSE_CACHE_FILE)) {
                fs.unlinkSync(VERSE_CACHE_FILE);
                console.log('🗑️ Fichier weekly-verse.json corrompu supprimé');
            }
        } catch (unlinkError) {
            console.error('Erreur lors de la suppression du fichier corrompu:', unlinkError);
        }
    }

    // Retourner un verset par défaut si aucun cache valide
    // Calculer le début de la semaine actuelle (lundi)
    const now = new Date();
    const dayOfWeek = now.getDay();
    const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - daysToMonday);
    weekStart.setHours(0, 0, 0, 0);

    const defaultDateISO = weekStart.toISOString().split('T')[0];
    return {
        id: defaultDateISO,
        text: 'Car Dieu a tant aimé le monde qu\'il a donné son Fils unique, afin que quiconque croit en lui ne périsse point, mais qu\'il ait la vie éternelle.',
        reference: 'Jean 3:16',
        date: 'Semaine du ' + weekStart.toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).split(' ').slice(1).join(' '),
        dateISO: defaultDateISO
    };
}

/**
 * Génère un nouveau verset biblique avec l'API Gemini
 * @returns {Promise<Object>} Objet contenant le verset, la référence et la date
 */
async function generateWeeklyVerse() {
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
        console.warn('⚠️ API_KEY non configurée, utilisation du verset par défaut');
        return loadWeeklyVerse();
    }

    try {
        const systemInstruction = `Tu es un assistant spirituel. Génère un verset biblique inspirant et approprié pour l'évangélisation, qui encourage les gens à découvrir la foi en Jésus-Christ. 

Réponds UNIQUEMENT au format JSON suivant (sans markdown, sans code blocks) :
{
  "text": "Le texte complet du verset",
  "reference": "Référence biblique (ex: Jean 3:16, Romains 8:28)",
  "theme": "Thème du verset en une phrase"
}

Le verset doit être :
- Inspirant et encourageant
- Adapté pour l'évangélisation
- Provenant de la Bible (Ancien ou Nouveau Testament)
- Complet et fidèle au texte biblique`;

        const requestBody = JSON.stringify({
            contents: [{
                parts: [{
                    text: systemInstruction
                }]
            }],
            generationConfig: {
                temperature: 0.7,
                topK: 40,
                topP: 0.95,
                maxOutputTokens: 1024
            }
        });

        return new Promise((resolve, reject) => {
            const options = {
                hostname: 'generativelanguage.googleapis.com',
                path: `/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            };

            const req = https.request(options, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        const response = JSON.parse(data);

                        if (response.candidates && response.candidates[0] && response.candidates[0].content) {
                            const text = response.candidates[0].content.parts[0].text;

                            // Extraire le JSON de la réponse
                            let jsonMatch = text.match(/\{[\s\S]*\}/);
                            if (!jsonMatch) {
                                // Si pas de JSON, essayer de parser directement
                                jsonMatch = [text];
                            }

                            const verseData = JSON.parse(jsonMatch[0]);

                            const now = new Date();
                            // Calculer le début de la semaine (lundi)
                            const dayOfWeek = now.getDay(); // 0 = dimanche, 1 = lundi, etc.
                            const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Si dimanche, aller au lundi précédent
                            const weekStart = new Date(now);
                            weekStart.setDate(now.getDate() - daysToMonday);
                            weekStart.setHours(0, 0, 0, 0);

                            const verseId = weekStart.toISOString().split('T')[0];
                            const verse = {
                                id: verseId, // ID unique basé sur le début de la semaine (lundi)
                                text: verseData.text || 'Car Dieu a tant aimé le monde...',
                                reference: verseData.reference || 'Jean 3:16',
                                date: 'Semaine du ' + weekStart.toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).split(' ').slice(1).join(' '),
                                dateISO: verseId,
                                theme: verseData.theme || 'Amour de Dieu',
                                slug: `verset-${verseId}` // Slug pour l'URL
                            };

                            // Sauvegarder dans le cache (verset actuel)
                            fs.writeFileSync(VERSE_CACHE_FILE, JSON.stringify(verse, null, 2));

                            // Ajouter à l'archive
                            let archive = [];
                            if (fs.existsSync(VERSE_ARCHIVE_FILE)) {
                                try {
                                    archive = JSON.parse(fs.readFileSync(VERSE_ARCHIVE_FILE, 'utf8'));
                                } catch (e) {
                                    archive = [];
                                }
                            }

                            // Vérifier si ce verset n'existe pas déjà (éviter les doublons)
                            const exists = archive.find(v => v.id === verse.id);
                            if (!exists) {
                                archive.unshift(verse); // Ajouter au début
                                // Garder seulement les 52 derniers versets (1 an)
                                if (archive.length > 52) {
                                    archive = archive.slice(0, 52);
                                }
                                fs.writeFileSync(VERSE_ARCHIVE_FILE, JSON.stringify(archive, null, 2));
                            }

                            console.log('✅ Nouveau verset hebdomadaire généré:', verse.reference, `(${verse.id})`);

                            resolve(verse);
                        } else {
                            console.error('❌ Réponse API invalide:', response);
                            resolve(loadWeeklyVerse());
                        }
                    } catch (error) {
                        console.error('❌ Erreur lors du parsing de la réponse:', error);
                        resolve(loadWeeklyVerse());
                    }
                });
            });

            req.on('error', (error) => {
                console.error('❌ Erreur lors de la requête API:', error);
                resolve(loadWeeklyVerse());
            });

            req.write(requestBody);
            req.end();
        });
    } catch (error) {
        console.error('❌ Erreur lors de la génération du verset:', error);
        return loadWeeklyVerse();
    }
}

/**
 * Vérifie et régénère le verset hebdomadaire si nécessaire
 */
async function checkAndUpdateWeeklyVerse() {
    const verse = loadWeeklyVerse();

    // Si aucun verset valide n'a été chargé, en générer un nouveau
    if (!verse || !verse.dateISO) {
        const now = new Date();
        const dayOfWeek = now.getDay();
        const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        const currentWeekStart = new Date(now);
        currentWeekStart.setDate(now.getDate() - daysToMonday);
        currentWeekStart.setHours(0, 0, 0, 0);
        console.log('🔄 Génération d\'un nouveau verset hebdomadaire pour la semaine du', currentWeekStart.toLocaleDateString('fr-FR'));
        await generateWeeklyVerse();
        return;
    }

    const verseDate = new Date(verse.dateISO + 'T00:00:00');
    const now = new Date();

    // Calculer le début de la semaine actuelle (lundi)
    const dayOfWeek = now.getDay();
    const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const currentWeekStart = new Date(now);
    currentWeekStart.setDate(now.getDate() - daysToMonday);
    currentWeekStart.setHours(0, 0, 0, 0);

    // Si le verset n'est pas pour la semaine en cours, en générer un nouveau
    if (verseDate.getTime() !== currentWeekStart.getTime()) {
        console.log('🔄 Génération d\'un nouveau verset hebdomadaire pour la semaine du', currentWeekStart.toLocaleDateString('fr-FR'));
        await generateWeeklyVerse();
    } else {
        console.log('✅ Verset hebdomadaire actuel valide jusqu\'au', new Date(currentWeekStart.getTime() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString('fr-FR'));
    }
}

/**
 * Génère une date ISO 8601 complète avec fuseau horaire (format Google recommandé)
 * @param {string} dateISO - Date au format YYYY-MM-DD
 * @returns {string} Date au format ISO 8601 complet (YYYY-MM-DDTHH:mm:ss+01:00)
 */
function getFullISO8601Date(dateISO) {
    if (!dateISO) {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');

        // Déterminer le fuseau horaire (France : +01:00 en hiver, +02:00 en été)
        const offset = -now.getTimezoneOffset();
        const offsetHours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0');
        const offsetMinutes = String(Math.abs(offset) % 60).padStart(2, '0');
        const offsetSign = offset >= 0 ? '+' : '-';

        return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${offsetSign}${offsetHours}:${offsetMinutes}`;
    }

    // Si on a une date ISO simple (YYYY-MM-DD), on ajoute l'heure et le fuseau horaire
    const date = new Date(dateISO + 'T00:00:00');
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    // Utiliser 10:00:00 comme heure par défaut (meilleure pratique)
    const hours = '10';
    const minutes = '00';
    const seconds = '00';

    // Fuseau horaire France (UTC+1 en hiver, UTC+2 en été)
    // On utilise +01:00 par défaut (on pourrait détecter automatiquement)
    const offset = '+01:00';

    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${offset}`;
}

/**
 * Génère l'URL de l'image pour un verset
 * @param {string} verseId - ID du verset (YYYY-MM-DD)
 * @returns {string} URL de l'image
 */
function getVerseImageUrl(verseId) {
    const baseUrl = 'https://foinouvelle.woutils.com';
    // Image générique biblique pour tous les versets
    // Pour personnaliser : créer un dossier /images/versets/ et ajouter des images spécifiques
    // Format recommandé : 1200x630px (ratio 1.91:1 pour les réseaux sociaux)
    return `${baseUrl}/images/verset-biblique.jpg`;
}

/**
 * Charge l'archive complète des versets
 * @returns {Array} Tableau de tous les versets archivés
 */
function loadVerseArchive() {
    try {
        if (fs.existsSync(VERSE_ARCHIVE_FILE)) {
            const data = fs.readFileSync(VERSE_ARCHIVE_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Erreur lors du chargement de l\'archive:', error);
    }
    return [];
}

/**
 * Récupère un verset spécifique par son ID
 * @param {string} verseId - ID du verset (format YYYY-MM-DD)
 * @returns {Object|null} Le verset ou null si non trouvé
 */
function getVerseById(verseId) {
    // Chercher d'abord dans l'archive
    const archive = loadVerseArchive();
    const archivedVerse = archive.find(v => v.id === verseId);
    if (archivedVerse) {
        return archivedVerse;
    }

    // Si non trouvé dans l'archive, vérifier si c'est le verset de la semaine actuelle
    const weeklyVerse = loadWeeklyVerse();
    const weeklyVerseId = weeklyVerse.id || weeklyVerse.dateISO;
    if (weeklyVerse && weeklyVerseId === verseId) {
        // S'assurer que le verset a bien un id pour la cohérence
        return {
            ...weeklyVerse,
            id: weeklyVerseId
        };
    }

    return null;
}

/**
 * Génère un sitemap dynamique incluant tous les versets archivés
 * @returns {Promise<string>} XML du sitemap
 */
async function generateDynamicSitemap() {
    const archive = loadVerseArchive();
    const baseUrl = 'https://foinouvelle.woutils.com';

    let sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${baseUrl}/</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${baseUrl}/index.html</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${baseUrl}/archive-versets</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`;

    // Ajouter tous les versets archivés
    archive.forEach(verse => {
        sitemap += `
  <url>
    <loc>${baseUrl}/verset/${verse.id}</loc>
    <lastmod>${verse.dateISO}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`;
    });

    sitemap += `
</urlset>`;

    return sitemap;
}

/**
 * Génère le HTML d'une page de verset individuel avec schéma Article
 * @param {Object} verse - Objet verset
 * @returns {string} HTML de la page
 */
function generateVersePage(verse) {
    const baseHtml = getIndexHtml();
    const archive = loadVerseArchive();
    const currentIndex = archive.findIndex(v => v.id === verse.id);
    const prevVerse = currentIndex > 0 ? archive[currentIndex - 1] : null;
    const nextVerse = currentIndex >= 0 && currentIndex < archive.length - 1 ? archive[currentIndex + 1] : null;

    // Remplacer le contenu principal par la page du verset
    const verseHtml = `
        <section class="py-16 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl shadow-lg mb-12">
            <div class="text-center max-w-4xl mx-auto">
                <nav class="mb-6 text-sm text-indigo-600" aria-label="Breadcrumb">
                    <a href="/" class="hover:underline">Accueil</a> / 
                    <a href="/archive-versets" class="hover:underline">Archive des Versets</a> / 
                    <span class="text-gray-600">${verse.reference}</span>
                </nav>
                
                <article itemscope itemtype="https://schema.org/Article">
                    <h1 class="text-4xl font-bold mb-6 text-indigo-800" itemprop="headline">Verset de la Semaine - ${verse.reference}</h1>
                    <div class="p-8 bg-white rounded-lg shadow-md border-l-4 border-indigo-500">
                        <blockquote class="text-2xl md:text-3xl font-medium text-gray-800 italic mb-6" itemprop="text">
                            "${verse.text}"
                        </blockquote>
                        <cite class="text-xl text-indigo-600 font-semibold block mb-4" itemprop="citation">
                            ${verse.reference}
                        </cite>
                        <p class="text-sm text-gray-600 mb-4">
                            <time datetime="${verse.dateISO}" itemprop="datePublished">${verse.date}</time>
                        </p>
                        ${verse.theme ? `<p class="text-base text-gray-700 italic" itemprop="about">${verse.theme}</p>` : ''}
                    </div>
                    
                    <div class="mt-8 p-6 bg-white rounded-lg shadow-md">
                        <h2 class="text-2xl font-bold mb-4 text-indigo-700">Réflexion sur ce verset</h2>
                        <p class="text-gray-700 leading-relaxed">
                            Ce verset biblique nous rappelle l'<strong>amour inconditionnel de Dieu</strong> et Sa <strong>grâce</strong> pour chacun de nous. 
                            La Parole de Dieu est vivante et puissante, et chaque verset peut transformer notre vie si nous l'acceptons avec foi.
                        </p>
                        <p class="text-gray-700 leading-relaxed mt-4">
                            Si ce message résonne en vous, nous vous encourageons à <a href="/#etapes" class="text-indigo-600 hover:underline font-semibold">explorer davantage le message de la foi</a> 
                            et à découvrir comment <a href="/#message" class="text-indigo-600 hover:underline font-semibold">Jésus-Christ peut transformer votre vie</a>. 
                            Vous pouvez également <a href="/#temoignages" class="text-indigo-600 hover:underline font-semibold">lire les témoignages</a> de ceux qui ont fait ce choix.
                        </p>
                        <div class="mt-6 flex flex-wrap gap-3 justify-center">
                            <a href="/#etapes" class="inline-block px-6 py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 transition duration-300">
                                Découvrir le Chemin vers Dieu
                            </a>
                            <a href="/archive-versets" class="inline-block px-6 py-3 bg-gray-600 text-white font-semibold rounded-lg hover:bg-gray-700 transition duration-300">
                                Voir tous les versets
                            </a>
                        </div>
                    </div>
                    
                    <!-- Navigation entre versets (maillage interne) -->
                    <nav class="mt-8 flex flex-col sm:flex-row gap-4 justify-between" aria-label="Navigation entre versets">
                        ${prevVerse ? `
                            <a href="/verset/${prevVerse.id}" class="p-4 bg-white rounded-lg shadow-md hover:shadow-xl transition duration-300 border-l-4 border-indigo-500 text-left">
                                <span class="text-sm text-gray-500">← Verset précédent</span>
                                <p class="font-semibold text-indigo-700 mt-1">${prevVerse.reference}</p>
                            </a>
                        ` : '<div></div>'}
                        ${nextVerse ? `
                            <a href="/verset/${nextVerse.id}" class="p-4 bg-white rounded-lg shadow-md hover:shadow-xl transition duration-300 border-l-4 border-indigo-500 text-left">
                                <span class="text-sm text-gray-500">Verset suivant →</span>
                                <p class="font-semibold text-indigo-700 mt-1">${nextVerse.reference}</p>
                            </a>
                        ` : '<div></div>'}
                    </nav>
                </article>
            </div>
        </section>
    `;

    // Injecter le verset dans le HTML de base
    let html = baseHtml.replace(
        /<main class="w-full max-w-4xl mx-auto p-4 md:p-8 flex-grow">[\s\S]*?<\/main>/,
        `<main class="w-full max-w-4xl mx-auto p-4 md:p-8 flex-grow">${verseHtml}</main>`
    );

    // Ajouter le schéma Article pour ce verset spécifique (corrigé selon recommandations Google)
    const fullDateISO = getFullISO8601Date(verse.dateISO);
    const articleSchema = {
        "@type": "Article",
        "@id": `https://foinouvelle.woutils.com/verset/${verse.id}`,
        "headline": `Verset de la Semaine - ${verse.reference}`,
        "description": verse.text.substring(0, 200),
        "text": verse.text,
        "image": getVerseImageUrl(verse.id),
        "author": {
            "@type": "Organization",
            "name": "Bible",
            "url": "https://www.bible.com"
        },
        "datePublished": fullDateISO,
        "dateModified": fullDateISO,
        "mainEntityOfPage": {
            "@type": "WebPage",
            "@id": `https://foinouvelle.woutils.com/verset/${verse.id}`
        },
        "about": {
            "@type": "Thing",
            "name": verse.theme || "Évangélisation"
        },
        "inLanguage": "fr"
    };

    // Injecter le schéma Article dans le JSON-LD
    const articleJson = JSON.stringify(articleSchema, null, 2);
    html = html.replace(
        /(\]\s*\}\s*<\/script>)/,
        `,\n        ${articleJson.replace(/\n/g, '\n        ')}\n      $1`
    );

    return html;
}

/**
 * Génère la page d'archive des versets avec maillage interne
 * @returns {string} HTML de la page d'archive
 */
function generateArchivePage() {
    const archive = loadVerseArchive();
    const baseHtml = getIndexHtml();

    let archiveContent = `
        <section class="py-16">
            <div class="text-center mb-12">
                <h1 class="text-4xl font-bold mb-4 text-indigo-800">Archive des Versets Hebdomadaires</h1>
                <p class="text-lg text-gray-600 mb-4">Découvrez tous les versets bibliques qui ont été partagés chaque semaine pour votre édification spirituelle</p>
                <nav class="text-sm text-indigo-600">
                    <a href="/" class="hover:underline">Accueil</a> / 
                    <a href="/#verset-semaine" class="hover:underline">Verset de la Semaine</a> / 
                    <span class="text-gray-600">Archive</span>
                </nav>
            </div>
            
            <div class="mb-8 p-4 bg-indigo-50 rounded-lg border-l-4 border-indigo-500">
                <p class="text-gray-700">
                    <strong>💡 Pourquoi lire les versets bibliques ?</strong> La Parole de Dieu est vivante et puissante. 
                    Chaque verset peut apporter <a href="/#message" class="text-indigo-600 hover:underline">guidance, espoir et transformation</a> dans votre vie. 
                    Explorez ces versets et découvrez comment <a href="/#etapes" class="text-indigo-600 hover:underline">Jésus-Christ peut changer votre vie</a>.
                </p>
            </div>
            
            <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
    `;

    archive.forEach((verse, index) => {
        archiveContent += `
            <article class="bg-white rounded-lg shadow-md p-6 hover:shadow-xl transition duration-300 border-l-4 border-indigo-500" itemscope itemtype="https://schema.org/Article">
                <a href="/verset/${verse.id}" class="block" itemprop="url">
                    <h2 class="text-xl font-bold mb-3 text-indigo-700" itemprop="headline">${verse.reference}</h2>
                    <blockquote class="text-gray-700 italic mb-4 line-clamp-3" itemprop="text">
                        "${verse.text.substring(0, 150)}${verse.text.length > 150 ? '...' : ''}"
                    </blockquote>
                    <p class="text-sm text-gray-500">
                        <time datetime="${verse.dateISO}" itemprop="datePublished">${verse.date}</time>
                    </p>
                    ${verse.theme ? `<p class="text-xs text-indigo-600 mt-2" itemprop="about">${verse.theme}</p>` : ''}
                    <span class="text-xs text-indigo-500 mt-2 block">Lire la suite →</span>
                </a>
            </article>
        `;
    });

    archiveContent += `
            </div>
            
            <div class="mt-12 p-6 bg-white rounded-lg shadow-md text-center">
                <h2 class="text-2xl font-bold mb-4 text-indigo-700">Vous cherchez à approfondir votre foi ?</h2>
                <p class="text-gray-700 mb-6">
                    Ces versets sont un excellent point de départ, mais la foi se vit aussi en communauté. 
                    <a href="/#find-church" class="text-indigo-600 hover:underline font-semibold">Trouvez une église près de chez vous</a> 
                    ou <a href="/#etapes" class="text-indigo-600 hover:underline font-semibold">découvrez comment commencer votre chemin avec Dieu</a>.
                </p>
                <div class="flex flex-wrap gap-3 justify-center">
                    <a href="/" class="inline-block px-6 py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 transition duration-300">
                        Retour à l'accueil
                    </a>
                    <a href="/#etapes" class="inline-block px-6 py-3 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 transition duration-300">
                        Commencer mon chemin de foi
                    </a>
                </div>
            </div>
        </section>
    `;

    return baseHtml.replace(
        /<main class="w-full max-w-4xl mx-auto p-4 md:p-8 flex-grow">[\s\S]*?<\/main>/,
        `<main class="w-full max-w-4xl mx-auto p-4 md:p-8 flex-grow">${archiveContent}</main>`
    );
}

/**
 * Envoie un email de notification
 * @param {Object} options - Options de l'email
 * @param {string} options.to - Destinataire
 * @param {string} options.subject - Sujet
 * @param {string} options.html - Corps HTML
 * @param {string} options.text - Corps texte (optionnel)
 */
async function sendEmail({ to, subject, html, text }) {
    try {
        const info = await transporter.sendMail({
            from: `"Foi Nouvelle" <${process.env.SMTP_USER}>`,
            to: to,
            subject: subject,
            html: html,
            text: text || html.replace(/<[^>]*>/g, '') // Extraire le texte du HTML si text n'est pas fourni
        });
        console.log('✅ Email envoyé:', info.messageId);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error('❌ Erreur lors de l\'envoi de l\'email:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Génère la page HTML de connexion admin
 * @returns {string} HTML de la page de connexion
 */
function getAdminLoginHtml() {
    return `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Administration - Foi Nouvelle</title>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gradient-to-r from-indigo-50 to-purple-50 min-h-screen flex items-center justify-center">
    <div class="bg-white p-8 rounded-lg shadow-xl max-w-md w-full">
        <h1 class="text-3xl font-bold text-indigo-800 mb-6 text-center">Administration</h1>
        <form id="loginForm" class="space-y-4">
            <div>
                <label for="username" class="block text-sm font-medium text-gray-700 mb-2">Nom d'utilisateur</label>
                <input type="text" id="username" name="username" required 
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent">
            </div>
            <div>
                <label for="password" class="block text-sm font-medium text-gray-700 mb-2">Mot de passe</label>
                <input type="password" id="password" name="password" required 
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent">
            </div>
            <div id="errorMessage" class="hidden text-red-600 text-sm"></div>
            <button type="submit" 
                class="w-full bg-indigo-600 text-white py-2 px-4 rounded-lg hover:bg-indigo-700 transition duration-200 font-semibold">
                Se connecter
            </button>
        </form>
    </div>
    <script>
        document.getElementById('loginForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            const errorDiv = document.getElementById('errorMessage');
            const submitButton = e.target.querySelector('button[type="submit"]');
            
            // Désactiver le bouton pendant la requête
            submitButton.disabled = true;
            submitButton.textContent = 'Connexion...';
            errorDiv.classList.add('hidden');
            
            try {
                const response = await fetch('/api/admin/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({ username, password })
                });
                
                let data;
                try {
                    data = await response.json();
                } catch (parseError) {
                    const text = await response.text();
                    console.error('Erreur parsing réponse:', parseError, 'Réponse:', text);
                    throw new Error('Réponse invalide du serveur');
                }
                
                if (data.success) {
                    // Redirection après un court délai pour laisser le cookie se définir
                    setTimeout(() => {
                        window.location.href = '/admin/dashboard';
                    }, 100);
                } else {
                    errorDiv.textContent = data.error || 'Erreur de connexion';
                    errorDiv.classList.remove('hidden');
                    submitButton.disabled = false;
                    submitButton.textContent = 'Se connecter';
                }
            } catch (error) {
                console.error('Erreur connexion:', error);
                errorDiv.textContent = 'Erreur de connexion au serveur: ' + error.message;
                errorDiv.classList.remove('hidden');
                submitButton.disabled = false;
                submitButton.textContent = 'Se connecter';
            }
        });
    </script>
</body>
</html>`;
}

/**
 * Génère la page HTML du dashboard admin
 * @returns {string} HTML du dashboard
 */
function getAdminDashboardHtml() {
    return `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dashboard Admin - Foi Nouvelle</title>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-100 min-h-screen">
    <nav class="bg-indigo-800 text-white p-4">
        <div class="container mx-auto flex justify-between items-center">
            <h1 class="text-2xl font-bold">Administration Foi Nouvelle</h1>
            <button id="logoutBtn" class="bg-red-600 hover:bg-red-700 px-4 py-2 rounded-lg transition">
                Déconnexion
            </button>
        </div>
    </nav>
    
    <div class="container mx-auto p-6">
        <!-- Statistiques -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div class="bg-white p-6 rounded-lg shadow">
                <h3 class="text-gray-600 text-sm font-medium mb-2">Compteur d'acceptations</h3>
                <p class="text-3xl font-bold text-indigo-600" id="acceptanceCounter">0</p>
                <input type="number" id="counterInput" class="mt-2 w-full px-3 py-2 border rounded" placeholder="Nouvelle valeur">
                <button onclick="updateCounter()" class="mt-2 w-full bg-indigo-600 text-white py-2 rounded hover:bg-indigo-700">
                    Mettre à jour
                </button>
            </div>
            <div class="bg-white p-6 rounded-lg shadow">
                <h3 class="text-gray-600 text-sm font-medium mb-2">Témoignages approuvés</h3>
                <p class="text-3xl font-bold text-green-600" id="approvedTestimonials">0</p>
            </div>
            <div class="bg-white p-6 rounded-lg shadow">
                <h3 class="text-gray-600 text-sm font-medium mb-2">Témoignages en attente</h3>
                <p class="text-3xl font-bold text-orange-600" id="pendingTestimonials">0</p>
            </div>
        </div>
        
        <!-- Verset de la semaine -->
        <div class="bg-white p-6 rounded-lg shadow mb-8">
            <div class="flex justify-between items-center mb-4">
                <h2 class="text-xl font-bold">Verset de la Semaine</h2>
                <button id="generateVerseBtn" onclick="generateNewVerse()" 
                    class="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition font-semibold text-sm">
                    <span id="generateVerseText">🔄 Générer un nouveau verset</span>
                    <span id="generateVerseSpinner" class="hidden">⏳ Génération...</span>
                </button>
            </div>
            <div id="weeklyVerse" class="text-gray-700"></div>
            <div id="verseMessage" class="mt-4 hidden"></div>
        </div>
        
        <!-- Liste des témoignages -->
        <div class="bg-white p-6 rounded-lg shadow mb-8">
            <h2 class="text-xl font-bold mb-4">Gestion des Témoignages</h2>
            <div id="testimonialsList" class="space-y-4">
                <p class="text-gray-500">Chargement...</p>
            </div>
        </div>
        
        <!-- Édition du contenu du site - Vue complète -->
        <div class="bg-white p-6 rounded-lg shadow">
            <h2 class="text-xl font-bold mb-6">Édition du Contenu du Site</h2>
            <p class="text-gray-600 mb-6">Modifiez directement le contenu de chaque section du site. Les modifications sont sauvegardées immédiatement.</p>
            
            <div id="allSectionsEditor" class="space-y-6">
                <p class="text-gray-500">Chargement du contenu...</p>
            </div>
        </div>
    </div>
    
    <script>
        // Vérifier l'authentification au chargement
        async function checkAuth() {
            const response = await fetch('/api/admin/check');
            const data = await response.json();
            if (!data.authenticated) {
                window.location.href = '/admin';
            }
        }
        
        // Charger les statistiques
        async function loadStats() {
            try {
                const response = await fetch('/api/admin/stats');
                const data = await response.json();
                
                if (data.success) {
                    document.getElementById('acceptanceCounter').textContent = data.stats.acceptanceCounter;
                    document.getElementById('approvedTestimonials').textContent = data.stats.testimonials.approved;
                    document.getElementById('pendingTestimonials').textContent = data.stats.testimonials.pending;
                    
                    const verse = data.stats.weeklyVerse;
                    document.getElementById('weeklyVerse').innerHTML = \`
                        <p class="font-semibold">\${verse.reference || 'N/A'}</p>
                        <p class="italic">"\${verse.text || 'N/A'}"</p>
                        <p class="text-sm text-gray-500 mt-2">\${verse.date || 'N/A'}</p>
                    \`;
                }
            } catch (error) {
                console.error('Erreur chargement stats:', error);
            }
        }
        
        // Charger les témoignages
        async function loadTestimonials() {
            try {
                const response = await fetch('/api/admin/testimonials');
                const data = await response.json();
                
                if (data.success) {
                    const list = document.getElementById('testimonialsList');
                    if (data.testimonials.length === 0) {
                        list.innerHTML = '<p class="text-gray-500">Aucun témoignage</p>';
                        return;
                    }
                    
                    list.innerHTML = data.testimonials.map(t => \`
                        <div class="border-l-4 \${t.adminApproved ? 'border-green-500' : 'border-orange-500'} p-4 bg-gray-50 rounded">
                            <p class="font-semibold text-indigo-600">\${t.name}</p>
                            <p class="text-gray-700 my-2">"\${t.story}"</p>
                            <div class="flex gap-2 mt-3">
                                <span class="text-xs text-gray-500">ID: \${t.id} | \${new Date(t.timestamp).toLocaleString('fr-FR')}</span>
                                <span class="text-xs px-2 py-1 rounded \${t.aiApproved ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                                    IA: \${t.aiApproved ? 'Approuvé' : 'Rejeté'}
                                </span>
                                <span class="text-xs px-2 py-1 rounded \${t.adminApproved ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800'}">
                                    Admin: \${t.adminApproved ? 'Approuvé' : 'En attente'}
                                </span>
                            </div>
                            <div class="flex gap-2 mt-3">
                                \${!t.adminApproved ? \`<button onclick="approveTestimonial(\${t.id})" class="bg-green-600 text-white px-4 py-1 rounded text-sm hover:bg-green-700">Approuver</button>\` : ''}
                                \${t.adminApproved ? \`<button onclick="rejectTestimonial(\${t.id})" class="bg-orange-600 text-white px-4 py-1 rounded text-sm hover:bg-orange-700">Désapprouver</button>\` : ''}
                                <button onclick="deleteTestimonial(\${t.id})" class="bg-red-600 text-white px-4 py-1 rounded text-sm hover:bg-red-700">Supprimer</button>
                            </div>
                        </div>
                    \`).join('');
                }
            } catch (error) {
                console.error('Erreur chargement témoignages:', error);
            }
        }
        
        // Mettre à jour le compteur
        async function updateCounter() {
            const newValue = parseInt(document.getElementById('counterInput').value);
            if (isNaN(newValue) || newValue < 0) {
                alert('Valeur invalide');
                return;
            }
            
            try {
                const response = await fetch('/api/admin/counter', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ count: newValue })
                });
                
                const data = await response.json();
                if (data.success) {
                    loadStats();
                    document.getElementById('counterInput').value = '';
                    alert('Compteur mis à jour');
                } else {
                    alert('Erreur: ' + data.error);
                }
            } catch (error) {
                alert('Erreur de connexion');
            }
        }
        
        // Approuver un témoignage
        async function approveTestimonial(id) {
            await updateTestimonial(id, 'approve');
        }
        
        // Rejeter un témoignage
        async function rejectTestimonial(id) {
            await updateTestimonial(id, 'reject');
        }
        
        // Supprimer un témoignage
        async function deleteTestimonial(id) {
            if (!confirm('Êtes-vous sûr de vouloir supprimer ce témoignage ?')) return;
            await updateTestimonial(id, 'delete');
        }
        
        // Mettre à jour un témoignage
        async function updateTestimonial(id, action) {
            try {
                const response = await fetch('/api/admin/testimonials', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id, action })
                });
                
                const data = await response.json();
                if (data.success) {
                    loadTestimonials();
                    loadStats();
                } else {
                    alert('Erreur: ' + data.error);
                }
            } catch (error) {
                alert('Erreur de connexion');
            }
        }
        
        // Générer un nouveau verset
        async function generateNewVerse() {
            const btn = document.getElementById('generateVerseBtn');
            const btnText = document.getElementById('generateVerseText');
            const spinner = document.getElementById('generateVerseSpinner');
            const messageDiv = document.getElementById('verseMessage');
            
            btn.disabled = true;
            btnText.classList.add('hidden');
            spinner.classList.remove('hidden');
            messageDiv.classList.add('hidden');
            
            try {
                const response = await fetch('/api/admin/generate-verse', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                
                const data = await response.json();
                
                if (data.success) {
                    messageDiv.className = 'mt-4 p-3 bg-green-100 border-l-4 border-green-500 rounded text-green-800';
                    messageDiv.textContent = '✅ Nouveau verset généré avec succès !';
                    messageDiv.classList.remove('hidden');
                    
                    // Recharger les statistiques pour afficher le nouveau verset
                    loadStats();
                } else {
                    messageDiv.className = 'mt-4 p-3 bg-red-100 border-l-4 border-red-500 rounded text-red-800';
                    messageDiv.textContent = '❌ Erreur: ' + (data.error || 'Impossible de générer le verset');
                    messageDiv.classList.remove('hidden');
                }
            } catch (error) {
                messageDiv.className = 'mt-4 p-3 bg-red-100 border-l-4 border-red-500 rounded text-red-800';
                messageDiv.textContent = '❌ Erreur de connexion: ' + error.message;
                messageDiv.classList.remove('hidden');
            } finally {
                btn.disabled = false;
                btnText.classList.remove('hidden');
                spinner.classList.add('hidden');
            }
        }
        
        // Charger tout le contenu du site
        async function loadAllSectionsContent() {
            const editorDiv = document.getElementById('allSectionsEditor');
            if (!editorDiv) {
                console.error('Élément allSectionsEditor non trouvé');
                return;
            }
            
            editorDiv.innerHTML = '<p class="text-gray-500">Chargement du contenu...</p>';
            
            const sections = [
                { key: 'hero', title: 'Hero - Section Principale', icon: '🏠' },
                { key: 'message_card_1', title: 'Message - Carte 1 (Amour de Dieu)', icon: '💝' },
                { key: 'message_card_2', title: 'Message - Carte 2 (Séparation/Péché)', icon: '⚠️' },
                { key: 'message_card_3', title: 'Message - Carte 3 (Jésus-Christ)', icon: '✝️' },
                { key: 'plan', title: 'Plan de Lecture', icon: '📖' },
                { key: 'explore', title: 'Explorateur IA', icon: '🤖' },
                { key: 'community', title: 'Communauté', icon: '👥' },
                { key: 'testimonials', title: 'Témoignages', icon: '💬' },
                { key: 'share', title: 'Partage', icon: '📤' },
                { key: 'steps', title: 'Prochaines Étapes', icon: '🚀' },
                { key: 'footer', title: 'Footer', icon: '📄' }
            ];
            
            let html = '';
            
            for (const section of sections) {
                try {
                    const response = await fetch(\`/api/admin/content/\${section.key}\`);
                    if (!response.ok) {
                        console.error(\`Erreur HTTP \${response.status} pour \${section.key}\`);
                        continue;
                    }
                    
                    const data = await response.json();
                    if (!data.success) {
                        console.error(\`Erreur API pour \${section.key}:\`, data.error);
                    }
                    
                    const content = data.success && data.content ? data.content : {};
                    const fields = getSectionFields(section.key);
                    
                    if (!fields || fields.length === 0) {
                        console.warn(\`Aucun champ défini pour \${section.key}\`);
                        continue;
                    }
                    
                    // Utilisation de template literals pour une génération plus propre
                    html += \`
                        <div class="border-2 border-gray-200 rounded-lg p-6 hover:border-indigo-300 transition mb-6">
                            <div class="flex justify-between items-center mb-4">
                                <h3 class="text-lg font-bold text-indigo-700">\${escapeHtml(section.icon)} \${escapeHtml(section.title)}</h3>
                                <button onclick="saveSectionContent('\${escapeHtml(section.key)}')" class="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 text-sm font-semibold">
                                    💾 Enregistrer
                                </button>
                            </div>
                            <div class="space-y-4" id="section_\${escapeHtml(section.key)}">
                    \`;
                    
                    fields.forEach(field => {
                        const value = content[field.key] || '';
                        const escapedValue = escapeHtml(value);
                        const fieldId = \`field_\${section.key}_\${field.key}\`;
                        const fieldLabel = escapeHtml(field.label);
                        const placeholder = field.placeholder || '';
                        
                        if (field.type === 'textarea') {
                            html += \`
                                <div class="mb-4">
                                    <label class="block text-sm font-medium text-gray-700 mb-2">\${fieldLabel}</label>
                                    <textarea id="\${fieldId}" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" rows="\${field.rows || 4}" placeholder="\${escapeHtml(placeholder)}">\${escapedValue}</textarea>
                                </div>
                            \`;
                        } else {
                            html += \`
                                <div class="mb-4">
                                    <label class="block text-sm font-medium text-gray-700 mb-2">\${fieldLabel}</label>
                                    <input type="text" id="\${fieldId}" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" value="\${escapedValue}" placeholder="\${escapeHtml(placeholder)}">
                                </div>
                            \`;
                        }
                    });
                    
                    html += \`
                            </div>
                            <div class="mt-4 pt-4 border-t">
                                <button onclick="resetSectionContent('\${escapeHtml(section.key)}')" class="text-sm text-gray-600 hover:text-red-600 underline">
                                    🔄 Réinitialiser aux valeurs par défaut
                                </button>
                            </div>
                        </div>
                    \`;
                } catch (error) {
                    console.error(\`Erreur chargement section \${section.key}:\`, error);
                    html += \`
                        <div class="border-2 border-red-200 rounded-lg p-6 mb-6">
                            <h3 class="text-lg font-bold text-red-700">\${section.icon} \${section.title}</h3>
                            <p class="text-red-600 mt-2">Erreur lors du chargement: \${error.message}</p>
                        </div>
                    \`;
                }
            }
            
            if (html === '') {
                editorDiv.innerHTML = '<p class="text-red-600">Erreur: Impossible de charger le contenu. Vérifiez la console pour plus de détails.</p>';
            } else {
                editorDiv.innerHTML = html;
            }
        }
        
        // Charger le contenu d'une section (ancienne fonction, gardée pour compatibilité)
        async function loadSectionContent() {
            loadAllSectionsContent();
        }
        
        // Obtenir les champs pour une section
        function getSectionFields(sectionKey) {
            const fieldsMap = {
                hero: [
                    { key: 'title', label: 'Titre principal', type: 'text' },
                    { key: 'subtitle_1', label: 'Sous-titre 1', type: 'textarea' },
                    { key: 'subtitle_2', label: 'Sous-titre 2', type: 'textarea' },
                    { key: 'button', label: 'Texte du bouton', type: 'text' }
                ],
                message_card_1: [
                    { key: 'title', label: 'Titre', type: 'text' },
                    { key: 'text', label: 'Texte', type: 'textarea' },
                    { key: 'footer', label: 'Pied de carte', type: 'textarea' }
                ],
                message_card_2: [
                    { key: 'title', label: 'Titre', type: 'text' },
                    { key: 'text', label: 'Texte', type: 'textarea' },
                    { key: 'footer', label: 'Pied de carte', type: 'textarea' }
                ],
                message_card_3: [
                    { key: 'title', label: 'Titre', type: 'text' },
                    { key: 'text', label: 'Texte', type: 'textarea' },
                    { key: 'footer', label: 'Pied de carte', type: 'textarea' }
                ],
                plan: [
                    { key: 'title', label: 'Titre', type: 'text' },
                    { key: 'days_1_3_title', label: 'Titre Jours 1-3', type: 'text' },
                    { key: 'days_4_7_title', label: 'Titre Jours 4-7', type: 'text' },
                    { key: 'footer', label: 'Pied de section', type: 'textarea' }
                ],
                explore: [
                    { key: 'title', label: 'Titre', type: 'text' },
                    { key: 'subtitle', label: 'Sous-titre', type: 'textarea', rows: 3 },
                    { key: 'placeholder', label: 'Placeholder du champ de recherche', type: 'text' },
                    { key: 'button', label: 'Texte du bouton', type: 'text' }
                ],
                community: [
                    { key: 'title', label: 'Titre', type: 'text' },
                    { key: 'subtitle', label: 'Sous-titre', type: 'textarea', rows: 3 },
                    { key: 'placeholder', label: 'Placeholder du champ de recherche', type: 'text' },
                    { key: 'button', label: 'Texte du bouton', type: 'text' }
                ],
                testimonials: [
                    { key: 'title', label: 'Titre de la section', type: 'text' },
                    { key: 'submit_title', label: 'Titre du formulaire de soumission', type: 'text' },
                    { key: 'submit_subtitle', label: 'Sous-titre du formulaire', type: 'textarea', rows: 3 },
                    { key: 'submit_name_placeholder', label: 'Placeholder nom', type: 'text' },
                    { key: 'submit_story_placeholder', label: 'Placeholder témoignage', type: 'text' },
                    { key: 'submit_button', label: 'Texte du bouton de soumission', type: 'text' }
                ],
                share: [
                    { key: 'title', label: 'Titre', type: 'text' },
                    { key: 'subtitle', label: 'Sous-titre', type: 'textarea', rows: 3 }
                ],
                steps: [
                    { key: 'title', label: 'Titre', type: 'text' },
                    { key: 'subtitle', label: 'Sous-titre', type: 'textarea', rows: 3 },
                    { key: 'button_prayer', label: 'Texte du bouton Prière', type: 'text' },
                    { key: 'button_contact', label: 'Texte du bouton Contact', type: 'text' },
                    { key: 'prayer_title', label: 'Titre section Prière', type: 'text' },
                    { key: 'prayer_text', label: 'Texte de la Prière', type: 'textarea', rows: 6 },
                    { key: 'contact_title', label: 'Titre section Contact', type: 'text' }
                ],
                footer: [
                    { key: 'subtitle', label: 'Sous-titre', type: 'textarea' }
                ]
            };
            
            return fieldsMap[sectionKey] || [];
        }
        
        // Sauvegarder le contenu d'une section
        async function saveSectionContent(sectionKey) {
            if (!sectionKey) {
                sectionKey = document.getElementById('contentSection')?.value;
                if (!sectionKey) return;
            }
            
            const fields = getSectionFields(sectionKey);
            const content = {};
            
            fields.forEach(field => {
                const input = document.getElementById(\`field_\${sectionKey}_\${field.key}\`) || document.getElementById(\`field_\${field.key}\`);
                if (input) {
                    content[field.key] = input.value;
                }
            });
            
            try {
                const response = await fetch(\`/api/admin/content/\${sectionKey}\`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content })
                });
                
                const data = await response.json();
                
                if (data.success) {
                    // Afficher un message de succès temporaire
                    const sectionDiv = document.getElementById(\`section_\${sectionKey}\`)?.parentElement;
                    if (sectionDiv) {
                        let messageDiv = sectionDiv.querySelector('.save-message');
                        if (!messageDiv) {
                            messageDiv = document.createElement('div');
                            messageDiv.className = 'save-message mt-2 p-2 bg-green-100 border-l-4 border-green-500 rounded text-green-800 text-sm';
                            sectionDiv.insertBefore(messageDiv, sectionDiv.firstChild);
                        }
                        messageDiv.textContent = '✅ Contenu enregistré avec succès !';
                        setTimeout(() => {
                            if (messageDiv) messageDiv.remove();
                        }, 3000);
                    }
                } else {
                    alert('❌ Erreur: ' + (data.error || 'Impossible d\\'enregistrer'));
                }
            } catch (error) {
                alert('Erreur lors de l\\'enregistrement: ' + error.message);
            }
        }
        
        // Réinitialiser le contenu d'une section
        async function resetSectionContent(sectionKey) {
            if (!sectionKey) {
                sectionKey = document.getElementById('contentSection')?.value;
                if (!sectionKey) return;
            }
            
            if (!confirm('Êtes-vous sûr de vouloir réinitialiser cette section aux valeurs par défaut ?')) return;
            
            try {
                const response = await fetch(\`/api/admin/content/\${sectionKey}\`, {
                    method: 'DELETE'
                });
                
                const data = await response.json();
                if (data.success) {
                    // Recharger toutes les sections
                    loadAllSectionsContent();
                } else {
                    alert('Erreur lors de la réinitialisation');
                }
            } catch (error) {
                alert('Erreur lors de la réinitialisation: ' + error.message);
            }
        }
        
        // Fonction utilitaire pour échapper le HTML
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
        
        // Déconnexion
        document.getElementById('logoutBtn').addEventListener('click', async () => {
            await fetch('/api/admin/logout', { method: 'POST' });
            window.location.href = '/admin';
        });
        
        // Initialisation
        async function init() {
            await checkAuth();
            loadStats();
            loadTestimonials();
            
            // Attendre un peu pour que le DOM soit complètement chargé
            setTimeout(() => {
                loadAllSectionsContent();
            }, 500);
        }
        
        // Démarrer l'initialisation
        init();
        
        // Rafraîchir toutes les 30 secondes
        setInterval(() => {
            loadStats();
            loadTestimonials();
        }, 30000);
    </script>
</body>
</html>`;
}

/**
 * Lit le fichier index.html et injecte les variables d'environnement
 */
function getIndexHtml() {
    const indexPath = path.join(__dirname, 'index.html');
    let html = fs.readFileSync(indexPath, 'utf8');

    // NOTE: L'API_KEY n'est plus injectée côté client pour des raisons de sécurité
    // Tous les appels à Gemini passent maintenant par le serveur (/api/gemini/generate)

    html = html.replace(
        /const CONTACT_EMAIL = "{{CONTACT_EMAIL}}";/,
        `const CONTACT_EMAIL = "${process.env.CONTACT_EMAIL || ''}";`
    );

    html = html.replace(
        /const CONTACT_PHONE = "{{CONTACT_PHONE}}";/,
        `const CONTACT_PHONE = "${process.env.CONTACT_PHONE || ''}";`
    );

    html = html.replace(
        /const ADMIN_NOTIFICATION_EMAIL = "{{ADMIN_NOTIFICATION_EMAIL}}";/,
        `const ADMIN_NOTIFICATION_EMAIL = "${process.env.ADMIN_NOTIFICATION_EMAIL || ''}";`
    );

    // Remplacer les placeholders dans les données structurées Schema.org
    html = html.replace(/\{\{CONTACT_EMAIL\}\}/g, process.env.CONTACT_EMAIL || '');
    html = html.replace(/\{\{CONTACT_PHONE\}\}/g, process.env.CONTACT_PHONE || '');

    // Charger et injecter le verset hebdomadaire
    const weeklyVerse = loadWeeklyVerse();
    const verseId = weeklyVerse.id || weeklyVerse.dateISO || new Date().toISOString().split('T')[0];

    html = html.replace(/\{\{WEEKLY_VERSE_TEXT\}\}/g, weeklyVerse.text || 'Car Dieu a tant aimé le monde qu\'il a donné son Fils unique...');
    html = html.replace(/\{\{WEEKLY_VERSE_REFERENCE\}\}/g, weeklyVerse.reference || 'Jean 3:16');
    html = html.replace(/\{\{WEEKLY_VERSE_DATE\}\}/g, weeklyVerse.date || 'Semaine du ' + new Date().toLocaleDateString('fr-FR'));
    html = html.replace(/\{\{WEEKLY_VERSE_DATE_ISO\}\}/g, weeklyVerse.dateISO || new Date().toISOString().split('T')[0]);
    html = html.replace(/\{\{WEEKLY_VERSE_ID\}\}/g, verseId);

    // Ajouter le schéma Article pour le verset actuel dans les données structurées (corrigé selon recommandations Google)
    if (weeklyVerse.id || weeklyVerse.dateISO) {
        const fullDateISO = getFullISO8601Date(weeklyVerse.dateISO || new Date().toISOString().split('T')[0]);
        const articleSchema = {
            "@type": "Article",
            "@id": `https://foinouvelle.woutils.com/verset/${verseId}`,
            "headline": `Verset de la Semaine - ${weeklyVerse.reference || 'Jean 3:16'}`,
            "description": (weeklyVerse.text || '').substring(0, 200),
            "text": weeklyVerse.text || '',
            "image": getVerseImageUrl(verseId),
            "author": {
                "@type": "Organization",
                "name": "Bible",
                "url": "https://www.bible.com"
            },
            "datePublished": fullDateISO,
            "dateModified": fullDateISO,
            "mainEntityOfPage": {
                "@type": "WebPage",
                "@id": `https://foinouvelle.woutils.com/verset/${verseId}`
            },
            "about": {
                "@type": "Thing",
                "name": weeklyVerse.theme || "Évangélisation"
            },
            "inLanguage": "fr"
        };

        // Injecter le schéma Article dans le JSON-LD existant
        const articleJson = JSON.stringify(articleSchema, null, 2);
        // Remplacer la fin du @graph pour ajouter l'article
        html = html.replace(
            /(\]\s*\}\s*<\/script>)/,
            `,\n        ${articleJson.replace(/\n/g, '\n        ')}\n      $1`
        );
    }

    // Charger tout le contenu personnalisé du site
    let siteContent = {};
    try {
        const rows = db.prepare('SELECT section_key, content_json FROM site_content WHERE language = ?').all('fr');
        rows.forEach(row => {
            try {
                const content = JSON.parse(row.content_json);
                // Aplatir la structure pour correspondre aux clés de traduction
                // Ex: section 'hero', champ 'title' -> clé 'hero_title'
                // Sauf si la clé existe déjà dans translations (ex: 'hero_title')

                // Stratégie : on passe l'objet structuré au front, et le front fera le mapping
                siteContent[row.section_key] = content;
            } catch (e) {
                console.error(`Erreur parsing JSON pour section ${row.section_key}:`, e);
            }
        });
    } catch (error) {
        console.error('Erreur chargement contenu site:', error);
    }

    // Injecter le contenu dans le HTML
    const contentScript = `<script>window.SERVER_CONTENT = ${JSON.stringify(siteContent)};</script>`;
    html = html.replace('</head>', `${contentScript}\n</head>`);

    return html;
}

/**
 * Détermine le type MIME d'un fichier
 */
function getContentType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.txt': 'text/plain',
        '.xml': 'application/xml'
    };
    return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Génère un token de session aléatoire
 * @returns {string} Token de session
 */
function generateSessionToken() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Vérifie si une session est valide
 * @param {string} token - Token de session
 * @returns {boolean} True si la session est valide
 */
function isValidSession(token) {
    if (!token || !ADMIN_SESSIONS.has(token)) {
        return false;
    }
    const session = ADMIN_SESSIONS.get(token);
    if (Date.now() > session.expires) {
        ADMIN_SESSIONS.delete(token);
        return false;
    }
    return true;
}

/**
 * Crée une nouvelle session admin
 * @returns {string} Token de session
 */
function createAdminSession() {
    const token = generateSessionToken();
    ADMIN_SESSIONS.set(token, {
        createdAt: Date.now(),
        expires: Date.now() + SESSION_DURATION
    });
    // Nettoyer les sessions expirées toutes les heures
    if (ADMIN_SESSIONS.size === 1) {
        setInterval(() => {
            const now = Date.now();
            for (const [t, s] of ADMIN_SESSIONS.entries()) {
                if (now > s.expires) {
                    ADMIN_SESSIONS.delete(t);
                }
            }
        }, 60 * 60 * 1000);
    }
    return token;
}

/**
 * Extrait le token de session depuis les cookies
 * @param {string} cookieHeader - En-tête Cookie de la requête
 * @returns {string|null} Token de session ou null
 */
function getSessionToken(cookieHeader) {
    if (!cookieHeader) return null;
    const cookies = cookieHeader.split(';').map(c => c.trim());
    for (const cookie of cookies) {
        if (cookie.startsWith('admin_session=')) {
            return cookie.substring('admin_session='.length);
        }
    }
    return null;
}

/**
 * Parse le corps de la requête POST
 */
function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                resolve(JSON.parse(body));
            } catch (e) {
                resolve(querystring.parse(body));
            }
        });
        req.on('error', reject);
    });
}

/**
 * Envoie une réponse JSON
 */
function sendJSON(res, statusCode, data) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end(JSON.stringify(data));
}

/**
 * Récupère l'adresse IP du client depuis la requête
 * @param {http.IncomingMessage} req - Objet de requête HTTP
 * @returns {string} Adresse IP du client
 */
function getClientIP(req) {
    // Vérifier les headers de proxy (X-Forwarded-For, X-Real-IP)
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        return forwarded.split(',')[0].trim();
    }

    const realIP = req.headers['x-real-ip'];
    if (realIP) {
        return realIP;
    }

    // Sinon, utiliser l'adresse de la socket
    return req.socket.remoteAddress || 'Inconnue';
}

/**
 * Récupère la localisation géographique à partir d'une adresse IP
 * @param {string} ip - Adresse IP
 * @returns {Promise<Object>} Informations de localisation
 */
function getLocationFromIP(ip) {
    return new Promise((resolve) => {
        // Ignorer les IPs locales
        if (!ip || ip === 'Inconnue' || ip.startsWith('127.') || ip.startsWith('::1') || ip === '::ffff:127.0.0.1') {
            resolve({
                ip: ip || 'Inconnue',
                country: 'Non disponible',
                region: 'Non disponible',
                city: 'Non disponible',
                isp: 'Non disponible'
            });
            return;
        }

        // Utiliser ip-api.com (gratuit, sans clé API)
        const apiUrl = `http://ip-api.com/json/${ip}?fields=status,message,country,regionName,city,isp,query`;

        http.get(apiUrl, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    if (result.status === 'success') {
                        resolve({
                            ip: result.query || ip,
                            country: result.country || 'Non disponible',
                            region: result.regionName || 'Non disponible',
                            city: result.city || 'Non disponible',
                            isp: result.isp || 'Non disponible'
                        });
                    } else {
                        resolve({
                            ip: ip,
                            country: 'Non disponible',
                            region: 'Non disponible',
                            city: 'Non disponible',
                            isp: 'Non disponible'
                        });
                    }
                } catch (error) {
                    console.error('Erreur lors de la récupération de la localisation:', error);
                    resolve({
                        ip: ip,
                        country: 'Erreur de récupération',
                        region: 'Erreur de récupération',
                        city: 'Erreur de récupération',
                        isp: 'Erreur de récupération'
                    });
                }
            });
        }).on('error', (error) => {
            console.error('Erreur lors de la requête de géolocalisation:', error);
            resolve({
                ip: ip,
                country: 'Erreur de connexion',
                region: 'Erreur de connexion',
                city: 'Erreur de connexion',
                isp: 'Erreur de connexion'
            });
        });
    });
}

/**
 * Crée le serveur HTTP
 */
const server = http.createServer(async (req, res) => {
    // Gérer les requêtes OPTIONS (CORS)
    if (req.method === 'OPTIONS') {
        res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        res.end();
        return;
    }

    const parsedUrl = url.parse(req.url, true);

    // API endpoint pour l'envoi d'email lors de la visite
    if (parsedUrl.pathname === '/api/notify-visit' && req.method === 'POST') {
        try {
            const data = await parseBody(req);
            const { userAgent, language, timestamp, userId } = data;

            // Récupérer l'IP et la localisation
            const clientIP = getClientIP(req);
            const location = await getLocationFromIP(clientIP);

            const emailHtml = `
                <h2>Nouvelle visite sur Foi Nouvelle</h2>
                <p><strong>Date et heure:</strong> ${timestamp || new Date().toISOString()}</p>
                <p><strong>ID utilisateur:</strong> ${userId || 'Non disponible'}</p>
                <p><strong>Langue:</strong> ${language || 'Non disponible'}</p>
                <p><strong>Navigateur:</strong> ${userAgent || 'Non disponible'}</p>
                <hr>
                <h3>📍 Localisation</h3>
                <p><strong>Adresse IP:</strong> ${location.ip}</p>
                <p><strong>Pays:</strong> ${location.country}</p>
                <p><strong>Région:</strong> ${location.region}</p>
                <p><strong>Ville:</strong> ${location.city}</p>
                <p><strong>Fournisseur Internet (ISP):</strong> ${location.isp}</p>
                <hr>
                <p><em>Cette notification a été envoyée automatiquement lors de la visite du site.</em></p>
            `;

            const result = await sendEmail({
                to: process.env.ADMIN_NOTIFICATION_EMAIL || process.env.SMTP_USER,
                subject: '🔔 Nouvelle visite sur Foi Nouvelle',
                html: emailHtml
            });

            sendJSON(res, result.success ? 200 : 500, result);
        } catch (error) {
            console.error('Erreur API notify-visit:', error);
            sendJSON(res, 500, { success: false, error: error.message });
        }
        return;
    }

    // API endpoint pour l'envoi d'email lors de l'acceptation de Jésus
    if (parsedUrl.pathname === '/api/notify-acceptance' && req.method === 'POST') {
        try {
            const data = await parseBody(req);
            const { userAgent, language, timestamp, userId } = data;

            // Récupérer le compteur depuis la base de données
            const counter = getAcceptanceCounter();

            // Récupérer l'IP et la localisation
            const clientIP = getClientIP(req);
            const location = await getLocationFromIP(clientIP);

            const emailHtml = `
                <h2>🎉 Une personne a accepté Jésus !</h2>
                <p><strong>Date et heure:</strong> ${timestamp || new Date().toISOString()}</p>
                <p><strong>ID utilisateur:</strong> ${userId || 'Non disponible'}</p>
                <p><strong>Langue:</strong> ${language || 'Non disponible'}</p>
                <p><strong>Navigateur:</strong> ${userAgent || 'Non disponible'}</p>
                <p><strong>Compteur total d'acceptations:</strong> ${counter}</p>
                <hr>
                <h3>📍 Localisation</h3>
                <p><strong>Adresse IP:</strong> ${location.ip}</p>
                <p><strong>Pays:</strong> ${location.country}</p>
                <p><strong>Région:</strong> ${location.region}</p>
                <p><strong>Ville:</strong> ${location.city}</p>
                <p><strong>Fournisseur Internet (ISP):</strong> ${location.isp}</p>
                <hr>
                <p style="color: #16a34a; font-weight: bold;">Une nouvelle personne a fait le choix de suivre Jésus !</p>
                <p><em>Cette notification a été envoyée automatiquement lors de l'acceptation de Jésus.</em></p>
            `;

            const result = await sendEmail({
                to: process.env.ADMIN_NOTIFICATION_EMAIL || process.env.SMTP_USER,
                subject: '🎉 Nouvelle acceptation de Jésus sur Foi Nouvelle',
                html: emailHtml
            });

            sendJSON(res, result.success ? 200 : 500, result);
        } catch (error) {
            console.error('Erreur API notify-acceptance:', error);
            sendJSON(res, 500, { success: false, error: error.message });
        }
        return;
    }

    // API endpoint pour récupérer le compteur global d'acceptations
    if (parsedUrl.pathname === '/api/acceptance-counter' && req.method === 'GET') {
        try {
            const count = getAcceptanceCounter();
            sendJSON(res, 200, { success: true, count: count });
        } catch (error) {
            console.error('Erreur API acceptance-counter GET:', error);
            sendJSON(res, 500, { success: false, error: error.message, count: 0 });
        }
        return;
    }

    // API endpoint pour incrémenter le compteur global d'acceptations
    if (parsedUrl.pathname === '/api/acceptance-counter/increment' && req.method === 'POST') {
        try {
            const newCount = incrementAcceptanceCounter();
            sendJSON(res, 200, { success: true, count: newCount });
        } catch (error) {
            console.error('Erreur API acceptance-counter increment:', error);
            sendJSON(res, 500, { success: false, error: error.message, count: 0 });
        }
        return;
    }

    // API endpoint pour générer du contenu avec Gemini (protège la clé API côté serveur)
    if (parsedUrl.pathname === '/api/gemini/generate' && req.method === 'POST') {
        const apiKey = process.env.API_KEY;
        if (!apiKey) {
            sendJSON(res, 500, { success: false, error: 'API_KEY non configurée côté serveur' });
            return;
        }

        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', async () => {
            try {
                const { prompt, systemInstruction, language = 'fr' } = JSON.parse(body);

                if (!prompt) {
                    sendJSON(res, 400, { success: false, error: 'Le prompt est requis' });
                    return;
                }

                // Noms de langues pour l'instruction système
                const langNames = {
                    'fr': 'Français', 'en': 'Anglais', 'es': 'Espagnol',
                    'de': 'Allemand', 'it': 'Italien', 'pt': 'Portugais',
                    'nl': 'Néerlandais', 'pl': 'Polonais'
                };
                const finalSystemInstruction = `${systemInstruction || ''} Répondez dans la langue: ${langNames[language] || 'Français'}.`.trim();

                const payload = {
                    contents: [{ parts: [{ text: prompt }] }],
                    tools: [{ "google_search": {} }], // Outil Google Search Grounding
                    systemInstruction: { parts: [{ text: finalSystemInstruction }] },
                };

                const options = {
                    hostname: 'generativelanguage.googleapis.com',
                    path: `/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                };

                const geminiReq = https.request(options, (geminiRes) => {
                    let data = '';

                    geminiRes.on('data', (chunk) => {
                        data += chunk;
                    });

                    geminiRes.on('end', () => {
                        try {
                            const result = JSON.parse(data);

                            if (geminiRes.statusCode !== 200) {
                                console.error('Erreur API Gemini:', result);
                                sendJSON(res, geminiRes.statusCode || 500, {
                                    success: false,
                                    error: result.error?.message || 'Erreur API Gemini',
                                    code: result.error?.code || 'UNKNOWN'
                                });
                                return;
                            }

                            const candidate = result.candidates?.[0];

                            if (candidate && candidate.content?.parts?.[0]?.text) {
                                const text = candidate.content.parts[0].text;
                                let sources = [];
                                const groundingMetadata = candidate.groundingMetadata;

                                if (groundingMetadata && groundingMetadata.groundingAttributions) {
                                    sources = groundingMetadata.groundingAttributions
                                        .map(attribution => ({
                                            uri: attribution.web?.uri,
                                            title: attribution.web?.title,
                                        }))
                                        .filter(source => source.uri && source.title);
                                }

                                sendJSON(res, 200, {
                                    success: true,
                                    text: text,
                                    sources: sources
                                });
                            } else {
                                console.error("Gemini API error (no text candidate):", result);
                                sendJSON(res, 500, {
                                    success: false,
                                    error: 'Aucune réponse générée par Gemini',
                                    result: result
                                });
                            }
                        } catch (error) {
                            console.error('Erreur parsing réponse Gemini:', error);
                            sendJSON(res, 500, { success: false, error: error.message });
                        }
                    });
                });

                geminiReq.on('error', (error) => {
                    console.error('Erreur requête Gemini:', error);
                    sendJSON(res, 500, { success: false, error: error.message });
                });

                geminiReq.write(JSON.stringify(payload));
                geminiReq.end();

            } catch (error) {
                console.error('Erreur API gemini/generate:', error);
                sendJSON(res, 500, { success: false, error: error.message });
            }
        });
        return;
    }

    // Gérer robots.txt
    if (parsedUrl.pathname === '/robots.txt') {
        const robotsPath = path.join(__dirname, 'robots.txt');
        fs.access(robotsPath, fs.constants.F_OK, (err) => {
            if (err) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('robots.txt not found');
                return;
            }
            fs.readFile(robotsPath, (err, data) => {
                if (err) {
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end('Error reading robots.txt');
                    return;
                }
                res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end(data);
            });
        });
        return;
    }

    // Gérer sitemap.xml (dynamique avec les versets)
    if (parsedUrl.pathname === '/sitemap.xml') {
        generateDynamicSitemap().then(sitemap => {
            res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
            res.end(sitemap);
        }).catch(err => {
            console.error('Erreur génération sitemap:', err);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Error generating sitemap');
        });
        return;
    }

    // Gérer la page d'archive des versets
    if (parsedUrl.pathname === '/archive-versets') {
        try {
            const html = generateArchivePage();
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
        } catch (error) {
            console.error('Erreur génération archive:', error);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Erreur serveur');
        }
        return;
    }

    // Gérer les pages individuelles de versets (/verset/YYYY-MM-DD)
    const verseMatch = parsedUrl.pathname.match(/^\/verset\/(\d{4}-\d{2}-\d{2})$/);
    if (verseMatch) {
        const verseId = verseMatch[1];
        const verse = getVerseById(verseId);

        if (verse) {
            try {
                const html = generateVersePage(verse);
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(html);
            } catch (error) {
                console.error('Erreur génération page verset:', error);
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Erreur serveur');
            }
        } else {
            // Verset non trouvé : rediriger vers la page d'accueil avec un message
            const baseHtml = getIndexHtml();
            const errorHtml = `
                <section class="py-16 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl shadow-lg mb-12">
                    <div class="text-center max-w-4xl mx-auto">
                        <h1 class="text-4xl font-bold mb-6 text-indigo-800">Verset non trouvé</h1>
                        <p class="text-gray-700 mb-6">Le verset demandé (${verseId}) n'a pas été trouvé dans l'archive.</p>
                        <div class="mt-6 flex flex-wrap gap-3 justify-center">
                            <a href="/" class="inline-block px-6 py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 transition duration-300">
                                Retour à l'accueil
                            </a>
                            <a href="/archive-versets" class="inline-block px-6 py-3 bg-gray-600 text-white font-semibold rounded-lg hover:bg-gray-700 transition duration-300">
                                Voir l'archive complète
                            </a>
                        </div>
                    </div>
                </section>
            `;

            const html = baseHtml.replace(
                /<main class="w-full max-w-4xl mx-auto p-4 md:p-8 flex-grow">[\s\S]*?<\/main>/,
                `<main class="w-full max-w-4xl mx-auto p-4 md:p-8 flex-grow">${errorHtml}</main>`
            );

            res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
        }
        return;
    }

    // =====================================================================
    // 🔐 ADMINISTRATION - Routes protégées
    // =====================================================================

    // Page de connexion admin
    if (parsedUrl.pathname === '/admin' && req.method === 'GET') {
        const cookieHeader = req.headers.cookie || '';
        const sessionToken = getSessionToken(cookieHeader);

        // Si déjà connecté, rediriger vers le dashboard
        if (sessionToken && isValidSession(sessionToken)) {
            res.writeHead(302, { 'Location': '/admin/dashboard' });
            res.end();
            return;
        }

        // Afficher la page de connexion
        const loginHtml = getAdminLoginHtml();
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(loginHtml);
        return;
    }

    // API de connexion admin
    if (parsedUrl.pathname === '/api/admin/login' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const { username, password } = data;

                if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
                    const token = createAdminSession();
                    res.writeHead(200, {
                        'Content-Type': 'application/json; charset=utf-8',
                        'Access-Control-Allow-Origin': '*',
                        'Set-Cookie': `admin_session=${token}; HttpOnly; Path=/; Max-Age=${SESSION_DURATION / 1000}; SameSite=Strict`
                    });
                    res.end(JSON.stringify({ success: true, token: token }));
                } else {
                    res.writeHead(401, {
                        'Content-Type': 'application/json; charset=utf-8',
                        'Access-Control-Allow-Origin': '*'
                    });
                    res.end(JSON.stringify({ success: false, error: 'Identifiants incorrects' }));
                }
            } catch (error) {
                res.writeHead(500, {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Access-Control-Allow-Origin': '*'
                });
                res.end(JSON.stringify({ success: false, error: error.message }));
            }
        });
        return;
    }

    // API de vérification de session
    if (parsedUrl.pathname === '/api/admin/check' && req.method === 'GET') {
        const cookieHeader = req.headers.cookie || '';
        const sessionToken = getSessionToken(cookieHeader);

        if (sessionToken && isValidSession(sessionToken)) {
            sendJSON(res, 200, { success: true, authenticated: true });
        } else {
            sendJSON(res, 401, { success: false, authenticated: false });
        }
        return;
    }

    // Middleware de vérification d'authentification pour les routes admin
    function requireAuth(req, res, next) {
        const cookieHeader = req.headers.cookie || '';
        const sessionToken = getSessionToken(cookieHeader);

        if (!sessionToken || !isValidSession(sessionToken)) {
            res.writeHead(302, { 'Location': '/admin' });
            res.end();
            return false;
        }
        return true;
    }

    // Dashboard admin (protégé)
    if (parsedUrl.pathname === '/admin/dashboard' && req.method === 'GET') {
        if (!requireAuth(req, res)) return;

        const dashboardHtml = getAdminDashboardHtml();
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(dashboardHtml);
        return;
    }

    // API admin - Récupérer les statistiques
    if (parsedUrl.pathname === '/api/admin/stats' && req.method === 'GET') {
        if (!requireAuth(req, res)) return;

        try {
            const counter = getAcceptanceCounter();
            const testimonials = db.prepare('SELECT COUNT(*) as total, SUM(CASE WHEN adminApproved = 1 THEN 1 ELSE 0 END) as approved, SUM(CASE WHEN adminApproved = 0 AND aiApproved = 1 THEN 1 ELSE 0 END) as pending FROM testimonials').get();
            const weeklyVerse = loadWeeklyVerse();

            sendJSON(res, 200, {
                success: true,
                stats: {
                    acceptanceCounter: counter,
                    testimonials: {
                        total: testimonials?.total || 0,
                        approved: testimonials?.approved || 0,
                        pending: testimonials?.pending || 0
                    },
                    weeklyVerse: weeklyVerse
                }
            });
        } catch (error) {
            sendJSON(res, 500, { success: false, error: error.message });
        }
        return;
    }

    // API admin - Récupérer tous les témoignages
    if (parsedUrl.pathname === '/api/admin/testimonials' && req.method === 'GET') {
        if (!requireAuth(req, res)) return;

        try {
            const testimonials = db.prepare('SELECT * FROM testimonials ORDER BY timestamp DESC').all();
            sendJSON(res, 200, { success: true, testimonials: testimonials });
        } catch (error) {
            sendJSON(res, 500, { success: false, error: error.message });
        }
        return;
    }

    // API admin - Approuver/Rejeter un témoignage
    if (parsedUrl.pathname === '/api/admin/testimonials' && req.method === 'POST') {
        if (!requireAuth(req, res)) return;

        try {
            const data = await parseBody(req);
            const { id, action } = data; // action: 'approve' ou 'reject' ou 'delete'

            if (action === 'approve') {
                db.prepare('UPDATE testimonials SET adminApproved = 1 WHERE id = ?').run(id);
            } else if (action === 'reject') {
                db.prepare('UPDATE testimonials SET adminApproved = 0 WHERE id = ?').run(id);
            } else if (action === 'delete') {
                db.prepare('DELETE FROM testimonials WHERE id = ?').run(id);
            } else {
                sendJSON(res, 400, { success: false, error: 'Action invalide' });
                return;
            }

            sendJSON(res, 200, { success: true });
        } catch (error) {
            sendJSON(res, 500, { success: false, error: error.message });
        }
        return;
    }

    // API admin - Modifier le compteur d'acceptations
    if (parsedUrl.pathname === '/api/admin/counter' && req.method === 'POST') {
        if (!requireAuth(req, res)) return;

        try {
            const data = await parseBody(req);
            const { count } = data;

            if (typeof count !== 'number' || count < 0) {
                sendJSON(res, 400, { success: false, error: 'Valeur invalide' });
                return;
            }

            db.prepare('UPDATE acceptance_counter SET count = ? WHERE id = 1').run(count);
            sendJSON(res, 200, { success: true, count: count });
        } catch (error) {
            sendJSON(res, 500, { success: false, error: error.message });
        }
        return;
    }

    // API admin - Générer un nouveau verset manuellement
    if (parsedUrl.pathname === '/api/admin/generate-verse' && req.method === 'POST') {
        if (!requireAuth(req, res)) return;

        try {
            console.log('🔄 Génération manuelle d\'un nouveau verset demandée par l\'admin...');

            // Forcer la génération d'un nouveau verset (ignorer le cache)
            const apiKey = process.env.API_KEY;
            if (!apiKey) {
                sendJSON(res, 500, { success: false, error: 'API_KEY non configurée côté serveur' });
                return;
            }

            const systemInstruction = `Tu es un assistant spirituel. Génère un verset biblique inspirant et approprié pour l'évangélisation, qui encourage les gens à découvrir la foi en Jésus-Christ. 

Réponds UNIQUEMENT au format JSON suivant (sans markdown, sans code blocks) :
{
  "text": "Le texte complet du verset",
  "reference": "Référence biblique (ex: Jean 3:16, Romains 8:28)",
  "theme": "Thème du verset en une phrase"
}

Le verset doit être :
- Inspirant et encourageant
- Adapté pour l'évangélisation
- Provenant de la Bible (Ancien ou Nouveau Testament)
- Complet et fidèle au texte biblique`;

            const requestBody = JSON.stringify({
                contents: [{
                    parts: [{
                        text: systemInstruction
                    }]
                }],
                generationConfig: {
                    temperature: 0.7,
                    topK: 40,
                    topP: 0.95,
                    maxOutputTokens: 1024
                }
            });

            return new Promise((resolve) => {
                const options = {
                    hostname: 'generativelanguage.googleapis.com',
                    path: `/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                };

                const req = https.request(options, (res2) => {
                    let data = '';

                    res2.on('data', (chunk) => {
                        data += chunk;
                    });

                    res2.on('end', () => {
                        try {
                            // Vérifier le code de statut HTTP
                            if (res2.statusCode !== 200) {
                                console.error('❌ Erreur API Gemini (status:', res2.statusCode, '):', data);

                                let errorMessage = `Erreur API Gemini (${res2.statusCode})`;

                                // Messages d'erreur spécifiques selon le code
                                if (res2.statusCode === 429) {
                                    errorMessage = 'Quota API Gemini dépassé. Veuillez vérifier votre plan et votre facturation dans Google Cloud Console. Vous pouvez réessayer plus tard.';
                                } else if (res2.statusCode === 401 || res2.statusCode === 403) {
                                    errorMessage = 'Clé API Gemini invalide ou expirée. Vérifiez votre clé API dans le fichier .env';
                                } else if (res2.statusCode === 400) {
                                    errorMessage = 'Requête invalide vers l\'API Gemini. Vérifiez la configuration.';
                                } else {
                                    // Essayer de parser l'erreur JSON
                                    try {
                                        const errorData = JSON.parse(data);
                                        if (errorData.error && errorData.error.message) {
                                            errorMessage = `Erreur API Gemini: ${errorData.error.message}`;
                                        }
                                    } catch (e) {
                                        errorMessage = `Erreur API Gemini (${res2.statusCode}): ${data.substring(0, 200)}`;
                                    }
                                }

                                sendJSON(res, res2.statusCode || 500, {
                                    success: false,
                                    error: errorMessage
                                });
                                resolve();
                                return;
                            }

                            const response = JSON.parse(data);

                            // Vérifier si c'est une erreur de l'API
                            if (response.error) {
                                console.error('❌ Erreur API Gemini:', response.error);
                                sendJSON(res, 500, {
                                    success: false,
                                    error: `Erreur API Gemini: ${response.error.message || JSON.stringify(response.error)}`
                                });
                                resolve();
                                return;
                            }

                            if (response.candidates && response.candidates[0] && response.candidates[0].content) {
                                const text = response.candidates[0].content.parts[0].text;

                                // Extraire le JSON de la réponse
                                let jsonMatch = text.match(/\{[\s\S]*\}/);
                                if (!jsonMatch) {
                                    console.error('❌ Aucun JSON trouvé dans la réponse:', text.substring(0, 200));
                                    sendJSON(res, 500, {
                                        success: false,
                                        error: 'Format de réponse invalide de Gemini'
                                    });
                                    resolve();
                                    return;
                                }

                                let verseData;
                                try {
                                    verseData = JSON.parse(jsonMatch[0]);
                                } catch (parseError) {
                                    console.error('❌ Erreur parsing JSON:', parseError, 'Texte:', jsonMatch[0]);
                                    sendJSON(res, 500, {
                                        success: false,
                                        error: 'Erreur lors du parsing du JSON: ' + parseError.message
                                    });
                                    resolve();
                                    return;
                                }

                                // Utiliser la date actuelle pour forcer un nouveau verset
                                const now = new Date();
                                const verseId = now.toISOString().split('T')[0] + '-' + now.getTime().toString().slice(-6); // Ajouter un timestamp pour l'unicité
                                const verse = {
                                    id: verseId,
                                    text: verseData.text || 'Car Dieu a tant aimé le monde...',
                                    reference: verseData.reference || 'Jean 3:16',
                                    date: 'Semaine du ' + now.toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).split(' ').slice(1).join(' '),
                                    dateISO: now.toISOString().split('T')[0],
                                    theme: verseData.theme || 'Amour de Dieu',
                                    slug: `verset-${verseId}`
                                };

                                // Sauvegarder dans le cache (verset actuel)
                                try {
                                    fs.writeFileSync(VERSE_CACHE_FILE, JSON.stringify(verse, null, 2));
                                } catch (writeError) {
                                    console.error('❌ Erreur écriture cache:', writeError);
                                }

                                // Ajouter à l'archive
                                let archive = [];
                                if (fs.existsSync(VERSE_ARCHIVE_FILE)) {
                                    try {
                                        archive = JSON.parse(fs.readFileSync(VERSE_ARCHIVE_FILE, 'utf8'));
                                    } catch (e) {
                                        archive = [];
                                    }
                                }

                                // Vérifier si ce verset n'existe pas déjà (éviter les doublons)
                                const exists = archive.find(v => v.id === verse.id);
                                if (!exists) {
                                    archive.unshift(verse); // Ajouter au début
                                    // Garder seulement les 52 derniers versets (1 an)
                                    if (archive.length > 52) {
                                        archive = archive.slice(0, 52);
                                    }
                                    try {
                                        fs.writeFileSync(VERSE_ARCHIVE_FILE, JSON.stringify(archive, null, 2));
                                    } catch (writeError) {
                                        console.error('❌ Erreur écriture archive:', writeError);
                                    }
                                }

                                console.log('✅ Nouveau verset généré manuellement:', verse.reference, `(${verse.id})`);

                                sendJSON(res, 200, {
                                    success: true,
                                    verse: verse,
                                    message: `Nouveau verset généré: ${verse.reference} (${verse.id})`
                                });
                                resolve();
                            } else {
                                console.error('❌ Réponse API invalide (pas de candidates):', JSON.stringify(response).substring(0, 500));
                                sendJSON(res, 500, {
                                    success: false,
                                    error: 'Réponse API invalide: pas de candidates dans la réponse'
                                });
                                resolve();
                            }
                        } catch (error) {
                            console.error('❌ Erreur lors du parsing de la réponse:', error, 'Data:', data.substring(0, 500));
                            sendJSON(res, 500, {
                                success: false,
                                error: 'Erreur lors du parsing de la réponse: ' + error.message
                            });
                            resolve();
                        }
                    });
                });

                req.on('error', (error) => {
                    console.error('❌ Erreur lors de la requête API:', error);
                    sendJSON(res, 500, {
                        success: false,
                        error: 'Erreur lors de la requête API: ' + error.message
                    });
                    resolve();
                });

                req.write(requestBody);
                req.end();
            });
        } catch (error) {
            console.error('Erreur génération manuelle verset:', error);
            sendJSON(res, 500, { success: false, error: error.message });
        }
        return;
    }

    // Contenu par défaut (fallback si la base de données est vide)
    const DEFAULT_CONTENT = {
        hero: {
            title: "Découvrez le Chemin vers Dieu et l'Espoir",
            subtitle_1: "Vous cherchez un sens à votre vie ? Découvrez comment **trouver la foi en Dieu**, le chemin vers Jésus et une communauté accueillante.",
            subtitle_2: "Découvrez l'amour inconditionnel et la puissance transformatrice de la foi. Où que vous soyez dans votre recherche, vous êtes le bienvenu.",
            button: "Je veux comprendre"
        },
        message_card_1: {
            title: "1. L'Amour Inconditionnel de Dieu",
            text: "Dieu est la source de toute existence et vous a créé(e) par amour. Son amour n'a pas de condition : il est total et éternel. Il n'attend pas que vous soyez parfait(e), mais que vous acceptiez Sa présence.",
            footer: "*Le point de départ de tout : Sa grâce est disponible, quel que soit votre passé.*"
        },
        message_card_2: {
            title: "2. La Réalité de la Séparation (Péché)",
            text: "Bien que nous soyons aimés, nos choix autonomes et nos erreurs (appelés péché) ont créé une distance. Ce n'est pas une liste de fautes, mais un état de séparation qui vous empêche d'atteindre la plénitude et de connaître Dieu intimement. C'est l'origine du vide que beaucoup ressentent.",
            footer: "*Le péché crée une barrière. C'est pourquoi nous avons besoin d'un pont.*"
        },
        message_card_3: {
            title: "3. Le Pont du Salut : Jésus-Christ",
            text: "Jésus est venu sur Terre pour combler la distance. Sa mort sur la croix et sa résurrection ne sont pas seulement un fait historique, mais l'acte qui rend le pardon total et la réconciliation possible. En L'acceptant comme Seigneur et Sauveur, vous traversez ce pont vers la relation avec Dieu.",
            footer: "*C'est un cadeau à accepter par la foi, non à mériter par les œuvres.*"
        },
        plan: {
            title: "Plan de Lecture 7 Jours : Commencer avec Jésus",
            days_1_3_title: "Jours 1-3 : L'Amour et le Pardon",
            days_4_7_title: "Jours 4-7 : La Nouvelle Vie",
            footer: "Ces versets sont un point de départ pour une lecture personnelle et quotidienne."
        },
        explore: {
            title: "✨ Poser des Questions sur la Foi (Explorateur IA)",
            subtitle: "Posez une question simple sur la foi. Notre IA (recherche assistée) vous fournira une explication claire et bienveillante.",
            placeholder: "Ex: Comment puis-je prier ?",
            button: "Expliquer"
        },
        community: {
            title: "Trouver une Communauté de Foi Accueillante",
            subtitle: "La foi est vécue en communauté. Trouvez une communauté locale pour être mieux accompagné dans votre marche.",
            placeholder: "Entrez votre ville (Ex: Paris, Ajaccio, Marseille)",
            button: "Rechercher"
        },
        testimonials: {
            title: "Histoires de Vie Transformée et Témoignages",
            submit_title: "Partagez Votre Histoire !",
            submit_subtitle: "Votre expérience peut inspirer quelqu'un d'autre. Racontez-nous comment votre rencontre avec Dieu a transformé votre vie.",
            submit_name_placeholder: "Votre nom ou pseudonyme",
            submit_story_placeholder: "Votre témoignage de vie...",
            submit_button: "Soumettre le Témoignage"
        },
        share: {
            title: "Partager le Message avec vos Proches",
            subtitle: "Aidez d'autres personnes à découvrir la foi ! Cliquez sur un bouton pour partager cette page."
        },
        steps: {
            title: "Prière de Conversion : Faire le Premier Pas",
            subtitle: "Si le message résonne en vous, voici les étapes simples pour commencer votre voyage de foi.",
            button_prayer: "Faire une Prière",
            button_contact: "Contacter Quelqu'un",
            prayer_title: "Votre Prière de Premier Pas",
            contact_title: "Nous Contacter",
            prayer_text: "« Père Céleste, je viens humblement devant Toi. Je reconnais que j'ai péché et que je me suis éloigné de Ton chemin. Je me repens sincèrement de toutes mes fautes et je Te demande pardon. Je crois que Jésus-Christ est Ton Fils, qu'Il est mort sur la croix pour mes péchés et qu'Il est ressuscité. Aujourd'hui, je T'ouvre mon cœur et je L'accepte comme mon Seigneur et mon Sauveur personnel. Je Te donne ma vie et je Te prie de me guider par Ton Saint-Esprit dès maintenant. Je veux vivre pour Toi. Au nom de Jésus, amen. »"
        },
        footer: {
            subtitle: "Trouver la Foi en Dieu | Guide, Prière et Communauté de Foi"
        }
    };

    // API admin - Récupérer le contenu d'une section
    const contentMatch = parsedUrl.pathname.match(/^\/api\/admin\/content\/(.+)$/);
    if (contentMatch && req.method === 'GET') {
        const cookieHeader = req.headers.cookie || '';
        const sessionToken = getSessionToken(cookieHeader);

        if (!sessionToken || !isValidSession(sessionToken)) {
            sendJSON(res, 401, { success: false, error: 'Non authentifié' });
            return;
        }

        try {
            const sectionKey = contentMatch[1];
            const result = db.prepare('SELECT content_json FROM site_content WHERE section_key = ? AND language = ?').get(sectionKey, 'fr');

            // Récupérer le contenu par défaut pour cette section
            const defaultSectionContent = DEFAULT_CONTENT[sectionKey] || {};

            if (result) {
                const dbContent = JSON.parse(result.content_json);
                // Fusionner avec le contenu par défaut pour s'assurer que tous les champs sont présents
                const mergedContent = { ...defaultSectionContent, ...dbContent };
                sendJSON(res, 200, { success: true, content: mergedContent });
            } else {
                // Si pas de contenu en base, renvoyer le contenu par défaut
                sendJSON(res, 200, { success: true, content: defaultSectionContent });
            }
        } catch (error) {
            sendJSON(res, 500, { success: false, error: error.message });
        }
        return;
    }

    // API admin - Sauvegarder le contenu d'une section
    if (contentMatch && req.method === 'POST') {
        if (!requireAuth(req, res)) return;

        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                const sectionKey = contentMatch[1];
                const data = JSON.parse(body);
                const { content } = data;

                const contentJson = JSON.stringify(content);

                // Insérer ou mettre à jour (SQLite syntax)
                const existing = db.prepare('SELECT id FROM site_content WHERE section_key = ? AND language = ?').get(sectionKey, 'fr');
                if (existing) {
                    db.prepare('UPDATE site_content SET content_json = ?, updated_at = CURRENT_TIMESTAMP WHERE section_key = ? AND language = ?')
                        .run(contentJson, sectionKey, 'fr');
                } else {
                    db.prepare('INSERT INTO site_content (section_key, content_json, language, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)')
                        .run(sectionKey, contentJson, 'fr');
                }

                console.log(`✅ Contenu sauvegardé pour section: ${sectionKey}`);
                sendJSON(res, 200, { success: true, message: 'Contenu enregistré avec succès' });
            } catch (error) {
                console.error('Erreur sauvegarde contenu:', error);
                sendJSON(res, 500, { success: false, error: error.message });
            }
        });
        return;
    }

    // API admin - Supprimer/Réinitialiser le contenu d'une section
    if (contentMatch && req.method === 'DELETE') {
        if (!requireAuth(req, res)) return;

        try {
            const sectionKey = contentMatch[1];
            db.prepare('DELETE FROM site_content WHERE section_key = ? AND language = ?').run(sectionKey, 'fr');

            console.log(`✅ Contenu réinitialisé pour section: ${sectionKey}`);
            sendJSON(res, 200, { success: true, message: 'Section réinitialisée' });
        } catch (error) {
            sendJSON(res, 500, { success: false, error: error.message });
        }
        return;
    }

    // API admin - Déconnexion
    if (parsedUrl.pathname === '/api/admin/logout' && req.method === 'POST') {
        const cookieHeader = req.headers.cookie || '';
        const sessionToken = getSessionToken(cookieHeader);

        if (sessionToken) {
            ADMIN_SESSIONS.delete(sessionToken);
        }

        res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Set-Cookie': 'admin_session=; HttpOnly; Path=/; Max-Age=0'
        });
        sendJSON(res, 200, { success: true });
        return;
    }

    // =====================================================================
    // FIN ADMINISTRATION
    // =====================================================================

    // Gérer la racine et index.html
    if (req.url === '/' || req.url === '/index.html') {
        try {
            const html = getIndexHtml();
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
        } catch (error) {
            console.error('Erreur lors de la lecture de index.html:', error);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Erreur serveur');
        }
        return;
    }

    // Servir les autres fichiers statiques si nécessaire
    const filePath = path.join(__dirname, req.url);

    // Sécurité : empêcher l'accès aux fichiers sensibles
    const sensitiveFiles = ['.env', '.env.local', '.env.production', 'package.json', 'node_modules'];
    const requestedFile = path.basename(req.url);
    const requestedPath = req.url.toLowerCase();

    // Bloquer l'accès aux fichiers sensibles
    if (sensitiveFiles.some(file => requestedPath.includes(file)) ||
        requestedPath.includes('/.env') ||
        requestedPath.includes('/node_modules/') ||
        requestedPath.includes('/package.json')) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Accès interdit');
        return;
    }

    // Sécurité : empêcher l'accès aux fichiers en dehors du répertoire
    if (!filePath.startsWith(__dirname)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Accès interdit');
        return;
    }

    fs.access(filePath, fs.constants.F_OK, (err) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Fichier non trouvé');
            return;
        }

        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Erreur lors de la lecture du fichier');
                return;
            }

            res.writeHead(200, { 'Content-Type': getContentType(filePath) });
            res.end(data);
        });
    });
});

// Vérifier et mettre à jour le verset hebdomadaire au démarrage
checkAndUpdateWeeklyVerse().then(() => {
    console.log('✅ Vérification du verset hebdomadaire terminée');
}).catch((error) => {
    console.error('❌ Erreur lors de la vérification du verset:', error);
});

// Vérifier le verset toutes les 24 heures
setInterval(() => {
    checkAndUpdateWeeklyVerse();
}, 24 * 60 * 60 * 1000); // 24 heures

server.listen(PORT, () => {
    console.log(`🚀 Serveur Foi Nouvelle démarré sur http://localhost:${PORT}`);
    console.log(`📝 Variables d'environnement chargées depuis .env`);
    console.log(`📖 Système de verset hebdomadaire activé`);
});


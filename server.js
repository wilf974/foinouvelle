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
const nodemailer = require('nodemailer');
require('dotenv').config();

const PORT = process.env.PORT || 2000;

// Fichiers pour stocker les versets
const VERSE_CACHE_FILE = path.join(__dirname, 'weekly-verse.json');
const VERSE_ARCHIVE_FILE = path.join(__dirname, 'verses-archive.json');

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
            const verse = JSON.parse(data);
            
            // Vérifier si le verset est encore valide (moins d'une semaine)
            const verseDate = new Date(verse.dateISO);
            const now = new Date();
            const daysDiff = (now - verseDate) / (1000 * 60 * 60 * 24);
            
            if (daysDiff < 7) {
                return verse;
            }
        }
    } catch (error) {
        console.error('Erreur lors du chargement du verset:', error);
    }
    
    // Retourner un verset par défaut si aucun cache valide
    return {
        text: 'Car Dieu a tant aimé le monde qu\'il a donné son Fils unique, afin que quiconque croit en lui ne périsse point, mais qu\'il ait la vie éternelle.',
        reference: 'Jean 3:16',
        date: 'Semaine du ' + new Date().toLocaleDateString('fr-FR'),
        dateISO: new Date().toISOString().split('T')[0]
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
                            const verse = {
                                id: now.toISOString().split('T')[0], // ID unique basé sur la date
                                text: verseData.text || 'Car Dieu a tant aimé le monde...',
                                reference: verseData.reference || 'Jean 3:16',
                                date: 'Semaine du ' + now.toLocaleDateString('fr-FR'),
                                dateISO: now.toISOString().split('T')[0],
                                theme: verseData.theme || 'Amour de Dieu',
                                slug: `verset-${now.toISOString().split('T')[0]}` // Slug pour l'URL
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
    const verseDate = new Date(verse.dateISO);
    const now = new Date();
    const daysDiff = (now - verseDate) / (1000 * 60 * 60 * 24);
    
    // Si le verset a plus d'une semaine, en générer un nouveau
    if (daysDiff >= 7) {
        console.log('🔄 Génération d\'un nouveau verset hebdomadaire...');
        await generateWeeklyVerse();
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
    const archive = loadVerseArchive();
    return archive.find(v => v.id === verseId) || null;
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
 * Lit le fichier index.html et injecte les variables d'environnement
 */
function getIndexHtml() {
    const indexPath = path.join(__dirname, 'index.html');
    let html = fs.readFileSync(indexPath, 'utf8');
    
    // Remplacer les placeholders dans le HTML
    html = html.replace(
        /const API_KEY = "{{API_KEY}}";/,
        `const API_KEY = "${process.env.API_KEY || ''}";`
    );
    
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
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
            const { userAgent, language, timestamp, userId, counter } = data;
            
            // Récupérer l'IP et la localisation
            const clientIP = getClientIP(req);
            const location = await getLocationFromIP(clientIP);
            
            const emailHtml = `
                <h2>🎉 Une personne a accepté Jésus !</h2>
                <p><strong>Date et heure:</strong> ${timestamp || new Date().toISOString()}</p>
                <p><strong>ID utilisateur:</strong> ${userId || 'Non disponible'}</p>
                <p><strong>Langue:</strong> ${language || 'Non disponible'}</p>
                <p><strong>Navigateur:</strong> ${userAgent || 'Non disponible'}</p>
                <p><strong>Compteur total d'acceptations:</strong> ${counter || 0}</p>
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
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Verset non trouvé');
        }
        return;
    }
    
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


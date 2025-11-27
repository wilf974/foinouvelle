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

// Fichier pour stocker le verset hebdomadaire
const VERSE_CACHE_FILE = path.join(__dirname, 'weekly-verse.json');

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
                            
                            const verse = {
                                text: verseData.text || 'Car Dieu a tant aimé le monde...',
                                reference: verseData.reference || 'Jean 3:16',
                                date: 'Semaine du ' + new Date().toLocaleDateString('fr-FR'),
                                dateISO: new Date().toISOString().split('T')[0],
                                theme: verseData.theme || 'Amour de Dieu'
                            };
                            
                            // Sauvegarder dans le cache
                            fs.writeFileSync(VERSE_CACHE_FILE, JSON.stringify(verse, null, 2));
                            console.log('✅ Nouveau verset hebdomadaire généré:', verse.reference);
                            
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
    html = html.replace(/\{\{WEEKLY_VERSE_TEXT\}\}/g, weeklyVerse.text || 'Car Dieu a tant aimé le monde qu\'il a donné son Fils unique...');
    html = html.replace(/\{\{WEEKLY_VERSE_REFERENCE\}\}/g, weeklyVerse.reference || 'Jean 3:16');
    html = html.replace(/\{\{WEEKLY_VERSE_DATE\}\}/g, weeklyVerse.date || 'Semaine du ' + new Date().toLocaleDateString('fr-FR'));
    html = html.replace(/\{\{WEEKLY_VERSE_DATE_ISO\}\}/g, weeklyVerse.dateISO || new Date().toISOString().split('T')[0]);
    
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
        '.jpg': 'image/jpg',
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
    
    // Gérer sitemap.xml
    if (parsedUrl.pathname === '/sitemap.xml') {
        const sitemapPath = path.join(__dirname, 'sitemap.xml');
        fs.access(sitemapPath, fs.constants.F_OK, (err) => {
            if (err) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('sitemap.xml not found');
                return;
            }
            fs.readFile(sitemapPath, (err, data) => {
                if (err) {
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end('Error reading sitemap.xml');
                    return;
                }
                res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
                res.end(data);
            });
        });
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


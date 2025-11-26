/**
 * Serveur Node.js simple pour servir l'application Foi Nouvelle
 * Injecte les variables d'environnement dans index.html
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const PORT = process.env.PORT || 2000;

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
        '.ico': 'image/x-icon'
    };
    return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Crée le serveur HTTP
 */
const server = http.createServer((req, res) => {
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

server.listen(PORT, () => {
    console.log(`🚀 Serveur Foi Nouvelle démarré sur http://localhost:${PORT}`);
    console.log(`📝 Variables d'environnement chargées depuis .env`);
});


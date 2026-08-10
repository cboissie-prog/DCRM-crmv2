# Sécurisation du serveur Plesk (VPS OVH) — Guide DCRM

> Contexte : VPS OVH + Plesk, app Node (Express :3001) derrière nginx/Apache de Plesk,
> déploiement via extension Git depuis GitHub master, PostgreSQL Plesk.
> Symptôme observé : scans de bots sur des fichiers `.php` inexistants (bruit de fond
> Internet normal — objectif : qu'ils ne trouvent jamais rien et soient bannis vite).

---

## 1. Firewall (à faire en premier)

### Plesk Firewall (extension gratuite)
1. Plesk → **Extensions** → installer **Plesk Firewall** si absent.
2. **Tools & Settings → Firewall** → activer, puis règles :
   - ✅ Autoriser : `443` (HTTPS), `80` (HTTP, uniquement pour la redirection vers HTTPS et Let's Encrypt), SSH (voir §3), `8443` (panel Plesk — à restreindre, voir ci-dessous)
   - ❌ **Bloquer tout le reste en entrée**, notamment :
     - `3001` (Node/Express — ne doit JAMAIS être accessible de l'extérieur, seulement via le proxy nginx local)
     - `5432` (PostgreSQL), `3306` (MySQL si présent)
     - `8880` (Plesk HTTP), `21` (FTP si non utilisé), `25/110/143/465/587/993/995` (mail, si tu n'héberges pas de mail sur ce VPS)
3. **Restreindre le port 8443 (panel Plesk) à ton IP** : si tu as une IP fixe au bureau/fibre, règle "Autoriser depuis 	<ton IP>, refuser le reste". Sinon, laisse ouvert mais avec fail2ban + 2FA (voir §2 et §4).

### Vérification que le port 3001 est bien fermé
Depuis chez toi :
```bash
# Doit échouer / timeout :
curl -m 5 http://<IP-du-VPS>:3001/api/health
```
Si ça répond, le firewall n'est pas actif ou Node écoute en public sans filtrage → corriger immédiatement.

> OVH propose aussi un **firewall réseau** (Network Firewall) dans l'espace client OVH,
> en amont du VPS : tu peux y dupliquer les mêmes règles — il filtre avant même
> d'atteindre la machine et protège aussi contre une partie des DDoS.

---

## 2. Fail2ban (bannir les bots automatiquement)

Plesk → **Tools & Settings → IP Address Banning (Fail2Ban)** :
1. **Activer Fail2ban**.
2. Activer au minimum les jails :
   - `plesk-apache` / `plesk-nginx` (ou `nginx-*`) — bannit les scans web (tes fameux `.php`)
   - `ssh` — brute-force SSH
   - `plesk-panel` — brute-force du login Plesk
   - `recidive` — re-bannit longtemps les récidivistes
3. Réglages recommandés : **maxretry 5**, **findtime 10 min**, **bantime 1h** (et `recidive` : bantime 1 semaine).
4. La jail nginx par défaut se déclenche surtout sur les 404 répétés et les auth échouées — avec la règle §5 (renvoyer 404/444 aux scans PHP), les bots se font bannir tout seuls.

---

## 3. SSH

- **Désactiver le login root par mot de passe** : dans `/etc/ssh/sshd_config` :
  ```
  PermitRootLogin prohibit-password   # ou "no" si tu as un user sudo
  PasswordAuthentication no           # clés SSH uniquement
  ```
  puis `systemctl restart sshd`. ⚠️ Vérifie d'abord que ta **clé SSH** fonctionne (`ssh -i ...`) avant de couper le mot de passe, sinon tu t'enfermes dehors (garde le KVM/console OVH en secours).
- Optionnel : changer le port SSH (réduit le bruit dans les logs, pas une vraie sécurité).

---

## 4. Panel Plesk

- **Activer la 2FA** sur ton compte admin Plesk (extension "Multi-Factor Authentication" ou paramètre du profil).
- Mot de passe admin long et unique (gestionnaire de mots de passe).
- **Tools & Settings → Update Settings** : activer les **mises à jour automatiques** de Plesk et des composants système.
- Désactiver les services non utilisés (Tools & Settings → Services Management) : FTP, mail, DNS si tu ne t'en sers pas — chaque service en moins = surface d'attaque en moins.
- Tools & Settings → **Security → ModSecurity** : activer le WAF (jeu de règles **OWASP** ou **Comodo**, mode "On"). Il bloque une grande partie des scans/injections avant même d'atteindre Node.

---

## 5. Couper court aux scans PHP (nginx)

Ton app est 100% Node — **aucune URL `.php` n'est légitime**. Dans Plesk :
**Websites & Domains → ton domaine → Apache & nginx Settings → Additional nginx directives** :

```nginx
# Les scans de bots (.php, .asp, wp-admin, etc.) : couper la connexion sans réponse
location ~* \.(php|phtml|asp|aspx|jsp|cgi|env)$ {
    return 444;
}
location ~* ^/(wp-admin|wp-login|wp-content|wordpress|phpmyadmin|pma|xmlrpc\.php) {
    return 444;
}
# Bloquer l'accès aux fichiers cachés (.git, .env, etc.)
location ~ /\. {
    deny all;
    return 444;
}
```

`return 444` = nginx ferme la connexion sans répondre (les scanners détestent, et
fail2ban peut compter ces hits). Résultat : le SPA fallback de Node ne répond plus
jamais `200 index.html` à un scan `.php`, et les bots abandonnent plus vite.

---

## 6. HTTPS

- **Let's Encrypt** via l'extension Plesk : certificat sur le domaine + renouvellement auto.
- **Hosting Settings** du domaine : cocher **"Permanent SEO-safe 301 redirect from HTTP to HTTPS"**.
- Apache & nginx Settings → activer **HSTS** si proposé (sinon le header est posé par Helmet côté Node).
- Tools & Settings → SSL/TLS : désactiver TLS 1.0/1.1, ne garder que TLS 1.2+.

---

## 7. Base de données PostgreSQL

- Vérifier que PostgreSQL **n'écoute qu'en local** (`listen_addresses = 'localhost'`) et que le port 5432 est bloqué par le firewall (§1).
- Utilisateur PostgreSQL dédié à l'app avec droits limités à sa base (pas de superuser).
- Mot de passe DB fort, stocké uniquement dans le `.env` du serveur (jamais dans Git).
- **Sauvegardes** : Plesk → Backup Manager → sauvegarde quotidienne programmée, avec copie **hors du VPS** (stockage FTP/S3/OVH Object Storage). Un serveur compromis ou perdu sans backup externe = données perdues.

---

## 8. L'application Node elle-même

- `NODE_ENV=production` sur le serveur.
- Le `.env` du serveur : permissions `600`, propriétaire = user de l'app, jamais commité.
- Node doit écouter sur `127.0.0.1` (ou être filtré par le firewall) — le proxy nginx de Plesk est le seul point d'entrée public.
- Mettre à jour Node.js (rester sur une LTS maintenue, ex. 20.x/22.x).
- Après chaque déploiement : `npm ci --omit=dev` côté serveur (pas de devDependencies en prod).

---

## 9. Surveillance & hygiène

- **Logs** : garde un œil sur `/var/www/vhosts/<domaine>/logs/` et les logs Plesk. Les 404/444 massifs = bots (normal). Ce qui doit t'alerter : des 200/401 répétés sur `/api/auth/login`.
- **Mises à jour système** : activer les MAJ automatiques de sécurité (`unattended-upgrades` sur Debian/Ubuntu — souvent gérable depuis Plesk).
- **Uptime + alerting** : un ping externe gratuit (UptimeRobot) sur `https://<domaine>` te prévient si le site tombe.
- Une fois par mois : `npm audit` dans `server/` et `client/`, MAJ Plesk, vérifier les backups (tester une restauration de temps en temps).

---

## 10. Points applicatifs à valider / planifier

Ces éléments ont été identifiés lors de l'audit du code mais **ne sont pas appliqués
automatiquement** car ils touchent la base de données ou l'infra et demandent ta décision.

### À vérifier côté Plesk (infra)
- **Document Root Passenger** : confirmer qu'il pointe bien sur `client/dist` (ou que
  toute requête non-statique passe par Passenger/Node), et **pas** sur la racine du repo.
  Sinon une requête directe `GET /server/.env` ou `GET /.git/config` pourrait être servie
  telle quelle par nginx. Les directives anti-scan du §5 couvrent déjà `/.` (dotfiles).
- **Repo GitHub privé** : confirmer que `github.com/…/DCRM-crmv2` est bien en **privé**.
  L'historique git contient d'anciens docs internes (rapports d'audit, schéma) — aucun secret
  réel dedans (vérifié), mais infos d'architecture. Si le repo doit rester public, purger
  l'historique avec `git filter-repo`.

### ~~À planifier~~ — FAIT le 10/08/2026 (migration `20260810_account_lockout_token_version`)
- ✅ **Verrouillage de compte** : 5 échecs de connexion → verrou 15 min (colonnes
  `failedLoginAttempts` + `lockedUntil` sur `User`, réponse 423 `ACCOUNT_LOCKED`, audit).
  Le login réussi ou l'expiration du verrou remet le compteur à zéro ; le reset par email
  déverrouille aussi. Complète le rate limiting par IP contre les attaques distribuées.
- ✅ **Invalidation immédiate des access tokens** : colonne `tokenVersion` sur `User`,
  embarquée dans le JWT et vérifiée en base par `authenticate` à chaque requête. Incrémentée
  à la désactivation, au changement de rôle/isActive et au changement/reset de mot de passe.
  Coût : une requête DB par requête authentifiée (assumé pour un CRM interne).
  Tests de régression : `server/tests/api/account-lockout.test.ts` (8 tests).

### Dépendance runtime
- **Node.js** : passer la prod sur Node **24 LTS** (ou 22 LTS). Node 25 est EOL depuis le
  01/06/2026 (plus de correctifs de sécurité). À changer dans le champ d'action Git de Plesk :
  `PATH=/opt/plesk/node/24/bin:$PATH …`. Le script de déploiement affiche désormais un
  avertissement s'il tourne sur une version non-LTS.

---

## Checklist rapide (dans l'ordre)

- [ ] Firewall Plesk activé — seuls 80/443/SSH/8443 ouverts, 3001 et 5432 bloqués
- [ ] Test `curl :3001` depuis l'extérieur → doit échouer
- [ ] Fail2ban activé (jails nginx, ssh, plesk-panel, recidive)
- [ ] Directives nginx anti-scan `.php` (return 444) en place
- [ ] ModSecurity (OWASP/Comodo) activé
- [ ] 2FA sur le panel Plesk + MAJ auto Plesk
- [ ] SSH par clé uniquement, root par mot de passe désactivé
- [ ] HTTPS forcé (301) + TLS 1.2+ uniquement
- [ ] PostgreSQL local uniquement + backups quotidiens externalisés
- [ ] Services inutilisés (FTP/mail/DNS) désactivés

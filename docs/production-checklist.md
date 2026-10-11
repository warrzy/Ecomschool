# Checklist de production — ECOM-SCHOOL

## Sécurité

- [x] Anti-brute-force : throttle mémoire + verrou persistant (8 échecs → 15 min)
- [x] Pas d'oracle temporel ni d'énumération sur login / reset
- [x] Isolation tenant vérifiée par tests IDOR (bulletins, reçus, pages)
- [x] `/api/cron` protégé par `CRON_SECRET` (comparaison constante)
- [x] En-têtes de sécurité HTTP configurés
- [x] Sessions bornées à 12 h, statut re-vérifié en base à chaque requête
- [x] Sessions d'assistance subordonnées à l'accord de l'école
- [ ] Throttle login mutualisé si déploiement multi-instances (risque documenté)
- [ ] Audit npm : vulnérabilités transitives connues non exploitables ; revérifier à chaque release

## Données

- [x] Pas de suppression physique des annonces (archivage `archivedAt`)
- [x] Rétention configurable + purge planifiée via cron
- [x] Marqueurs de déduplication préservés par la purge
- [x] Migrations create-only, sauvegarde avant chaque migration
- [ ] Durées `RETENTION_*` validées contractuellement avec les établissements

## Confidentialité / conformité (à valider juridiquement)

- [x] Consentements SMS/WhatsApp tuteurs + opt-in WhatsApp par défaut
- [x] Préférences utilisateur + non-désinscription des messages transactionnels
- [x] Journalisation d'audit traçable
- [ ] Politique de confidentialité rédigée et validée (données de mineurs)
- [ ] Registre des traitements / sous-traitants identifiés
- [ ] Localisation des données et obligations Burkina Faso à faire valider
- **La plateforme n'est pas déclarée juridiquement conforme** — validation
  compétente requise avant mise en production.

## Exploitation

- [x] `/api/cron` testé (401 sans/avec mauvais secret, 200 avec, exécution réelle)
- [ ] Planificateur externe configuré sur l'environnement cible
- [ ] Alertes sur jobs DEAD et échecs cron
- [x] Sauvegarde + restauration testées sur environnement isolé
- [ ] RPO/RTO contractualisés ; restauration de contrôle planifiée
- [x] `.env.example` complet sans secrets
- [ ] Secrets de production générés et stockés hors dépôt

## Qualité

- [x] Régressions Phases 2–9
- [x] Typecheck / lint / build production
- [x] E2E Playwright : 30/30 (auth, isolation, IDOR, cron, verrouillage, captures)
- [x] Test de charge mesuré (voir `docs/phase10-performance.md`)
- [ ] Re-mesure de charge sur l'infrastructure cible

## Décision

**Préparation production : GO conditionnel** — les critères techniques majeurs
sont couverts et testés. Points de vigilance avant bascule : validation
juridique de la confidentialité, planificateur externe et alertes configurés,
et mesure de charge sur l'infrastructure cible.

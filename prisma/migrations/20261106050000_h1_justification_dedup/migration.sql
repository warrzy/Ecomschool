-- Anti-doublon : un seul justificatif d'absence OUVERT par relevé de
-- présence et par établissement. Une demande clôturée (RESOLVED /
-- REJECTED / CANCELLED) sort de l'index → nouvelle soumission possible.
CREATE UNIQUE INDEX "h1_admin_req_open_justification"
    ON "AdministrativeRequest" ("schoolId", "contextRef")
    WHERE "type" = 'ABSENCE_JUSTIFICATION'
      AND "status" IN ('SUBMITTED', 'IN_PROGRESS');

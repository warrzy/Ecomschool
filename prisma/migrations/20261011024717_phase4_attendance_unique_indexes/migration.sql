-- Index partiels manuels : unicité des appels
-- - un statut par élève par séance
CREATE UNIQUE INDEX IF NOT EXISTS "AttendanceRecord_session_student_key"
  ON "AttendanceRecord"("sessionId", "studentId") WHERE "sessionId" IS NOT NULL;

-- - un statut par élève par jour quand pas de séance (appel journalier)
CREATE UNIQUE INDEX IF NOT EXISTS "AttendanceRecord_daily_key"
  ON "AttendanceRecord"("studentId", "date") WHERE "sessionId" IS NULL;

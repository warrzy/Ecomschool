import { verifyPublicDocument } from "@/lib/services/administrative-docs";

export const metadata = { title: "Vérification de document — ECOM-SCHOOL" };
export const instant = false;

const STATUS_UI = {
  VALID: { label: "Document valide", color: "#1e7d34", bg: "#e8f5ec" },
  REVOKED: { label: "Document révoqué", color: "#9c2b2b", bg: "#fbeaea" },
  UNKNOWN: { label: "Document inconnu", color: "#6b4b00", bg: "#fdf6e3" },
} as const;

/** Vérification publique d'un document administratif — sans session. */
export default async function VerifyPage(props: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await props.params;
  const v = await verifyPublicDocument(code);
  const ui = STATUS_UI[v.status];

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f4f5f7",
        fontFamily: "system-ui, sans-serif",
        padding: 24,
      }}
    >
      <div
        style={{
          maxWidth: 520,
          width: "100%",
          background: "#fff",
          borderRadius: 12,
          padding: 32,
          boxShadow: "0 2px 12px rgba(0,0,0,.08)",
        }}
      >
        <div
          style={{
            display: "inline-block",
            padding: "6px 14px",
            borderRadius: 999,
            background: ui.bg,
            color: ui.color,
            fontWeight: 700,
            fontSize: 14,
          }}
        >
          {ui.label}
        </div>

        {v.status === "UNKNOWN" ? (
          <p style={{ marginTop: 20, color: "#555", fontSize: 14 }}>
            Aucun document ne correspond à ce code de vérification. Le document
            n&rsquo;existe pas ou le lien est incomplet.
          </p>
        ) : (
          <dl style={{ marginTop: 24, fontSize: 14, lineHeight: 1.9 }}>
            <div>
              <dt style={{ color: "#777", fontSize: 12 }}>Type de document</dt>
              <dd style={{ margin: 0, fontWeight: 600 }}>{v.typeLabel}</dd>
            </div>
            <div>
              <dt style={{ color: "#777", fontSize: 12 }}>Référence</dt>
              <dd style={{ margin: 0, fontWeight: 600 }}>{v.number}</dd>
            </div>
            <div>
              <dt style={{ color: "#777", fontSize: 12 }}>Établissement</dt>
              <dd style={{ margin: 0 }}>{v.schoolName}</dd>
            </div>
            <div>
              <dt style={{ color: "#777", fontSize: 12 }}>Élève</dt>
              <dd style={{ margin: 0 }}>{v.studentName}</dd>
            </div>
            <div>
              <dt style={{ color: "#777", fontSize: 12 }}>Année scolaire</dt>
              <dd style={{ margin: 0 }}>{v.academicYear}</dd>
            </div>
            <div>
              <dt style={{ color: "#777", fontSize: 12 }}>Date d&rsquo;émission</dt>
              <dd style={{ margin: 0 }}>{v.issuedAt}</dd>
            </div>
          </dl>
        )}

        <p style={{ marginTop: 28, fontSize: 11, color: "#999" }}>
          Vérification ECOM-SCHOOL — comparez ces informations avec le document
          présenté. Seules les informations strictement nécessaires sont
          affichées.
        </p>
      </div>
    </main>
  );
}

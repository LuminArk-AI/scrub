/**
 * Printable-style markdown from get_patient_med_context payload.
 */

export type PatientMedContextData = {
  patientId: string;
  generatedAt: string;
  medicationCount: number;
  medications: {
    name: string;
    dosage: string;
    authoredOn: string;
    why: string[];
    enrichment: {
      genericName: string;
      brandNames: string[];
      therapeuticClasses: string[];
    } | null;
    source: string;
    fhirId: string;
  }[];
  footer: string;
};

function escapeMdLine(s: string): string {
  return s.replace(/\|/g, "\\|");
}

export function renderMedContextDocument(data: PatientMedContextData): string {
  const lines: string[] = [
    "# Medication summary",
    "",
    `**Patient:** \`${data.patientId}\`  `,
    `**Generated:** ${data.generatedAt}  `,
    `**Active medications:** ${data.medicationCount}`,
    "",
    "---",
    "",
  ];

  for (let i = 0; i < data.medications.length; i++) {
    const m = data.medications[i];
    lines.push(`## ${i + 1}. ${escapeMdLine(m.name)}`);
    lines.push("");
    lines.push(`- **Dosage:** ${escapeMdLine(m.dosage)}`);
    lines.push(`- **Authored / asserted:** ${escapeMdLine(m.authoredOn)}`);
    lines.push(`- **Source:** ${m.source} · \`${m.fhirId}\``);
    lines.push("");
    lines.push("**Why (per chart)**");
    for (const w of m.why) {
      lines.push(`- ${escapeMdLine(w)}`);
    }
    lines.push("");
    if (m.enrichment) {
      lines.push("**Drug reference (RxNav)**");
      lines.push(`- **Generic:** ${escapeMdLine(m.enrichment.genericName)}`);
      const brands = m.enrichment.brandNames.length
        ? m.enrichment.brandNames.map(escapeMdLine).join(", ")
        : "(none listed)";
      lines.push(`- **Brand names:** ${brands}`);
      const classes = m.enrichment.therapeuticClasses.length
        ? m.enrichment.therapeuticClasses.map(escapeMdLine).join(", ")
        : "(none listed)";
      lines.push(`- **Therapeutic class:** ${classes}`);
      lines.push("");
    } else {
      lines.push("*No RxNorm enrichment for this medication.*");
      lines.push("");
    }
    lines.push("---");
    lines.push("");
  }

  lines.push(`*${escapeMdLine(data.footer)}*`);
  lines.push("");

  return lines.join("\n");
}

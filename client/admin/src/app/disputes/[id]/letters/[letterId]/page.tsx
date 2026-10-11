"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import api from "@/lib/api";
import { DisputeLetter, OFFICE_LABEL } from "@/lib/disputes";

/**
 * Ruling 13 — the letter, exactly as generated (the stored snapshot), laid out
 * for paper. "Print" in the browser gives the printed copy or a PDF. No
 * console chrome: what prints is the letter and nothing else.
 */
export default function LetterPage() {
  const { id, letterId } = useParams<{ id: string; letterId: string }>();
  const [letter, setLetter] = useState<DisputeLetter | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get(`/admin/disputes/${id}`)
      .then((res) => {
        const l = (res.data.data.letters as DisputeLetter[]).find((x) => x.id === letterId);
        if (!l) setError("Letter not found");
        else setLetter(l);
      })
      .catch((e) => setError(e?.response?.data?.error || "Failed to load the letter"));
  }, [id, letterId]);

  if (error) return <p style={{ padding: 32 }}>{error}</p>;
  if (!letter) return <p style={{ padding: 32 }}>Loading…</p>;
  const c = letter.content;

  return (
    <div className="letter-root">
      <style>{`
        .letter-root { background: #e9ecef; min-height: 100vh; padding: 24px 0; color: #111; }
        .letter-page { background: #fff; width: 210mm; min-height: 297mm; margin: 0 auto; padding: 22mm 20mm;
          font-family: "Times New Roman", Georgia, serif; font-size: 11.5pt; line-height: 1.45; box-shadow: 0 2px 8px rgba(0,0,0,.15); }
        .letter-page h1 { font-size: 15pt; margin: 0; letter-spacing: .5px; }
        .letter-page h2 { font-size: 11.5pt; margin: 18px 0 6px; text-transform: uppercase; letter-spacing: .5px; }
        .letter-page table { width: 100%; border-collapse: collapse; font-size: 10.5pt; }
        .letter-page td, .letter-page th { border: 1px solid #999; padding: 4px 6px; vertical-align: top; text-align: left; }
        .letter-page th { background: #f1f3f5; width: 34%; font-weight: 600; }
        .letter-meta { display: flex; justify-content: space-between; margin: 14px 0 18px; font-size: 10.5pt; }
        .letter-toolbar { width: 210mm; margin: 0 auto 12px; display: flex; gap: 8px; justify-content: flex-end; font-family: system-ui, sans-serif; }
        .letter-toolbar button { padding: 8px 14px; border-radius: 6px; border: 1px solid #0b7a6f; background: #0b7a6f; color: #fff; cursor: pointer; }
        .muted { color: #555; font-size: 9.5pt; }
        @media print {
          .letter-root { background: #fff; padding: 0; }
          .letter-toolbar { display: none; }
          .letter-page { box-shadow: none; margin: 0; width: auto; min-height: auto; padding: 0; }
          @page { size: A4; margin: 18mm; }
        }
      `}</style>
      <div className="letter-toolbar">
        <span style={{ marginRight: "auto", alignSelf: "center" }}>
          {letter.referenceNo} · {OFFICE_LABEL[letter.office] ?? letter.office}
          {letter.submittedAt ? " · submitted" : " · not yet submitted"}
        </span>
        <button onClick={() => window.print()}>Print / Save as PDF</button>
      </div>
      <div className="letter-page">
        <h1>EngiRent Hub</h1>
        <div className="muted">Peer-to-peer equipment rental for UCLM engineering students</div>
        <div className="letter-meta">
          <div>
            {c.addressee.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
          <div style={{ textAlign: "right" }}>
            <div>{c.date}</div>
            <div>Ref. {letter.referenceNo}</div>
          </div>
        </div>
        <p>
          <b>Subject: {c.subject}</b>
        </p>
        <p>{c.salutation}</p>
        {c.paragraphs.map((p) => (
          <p key={p}>{p}</p>
        ))}

        <h2>Facts of the case</h2>
        <table>
          <tbody>
            {c.facts.map(([k, v]) => (
              <tr key={k}>
                <th>{k}</th>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2>Timeline of notices</h2>
        <table>
          <tbody>
            {c.timeline.map((t, i) => (
              <tr key={i}>
                <th>{t.at}</th>
                <td>{t.what}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2>Contact attempts by personnel</h2>
        {c.contacts.length === 0 ? (
          <p className="muted">None recorded when this letter was generated.</p>
        ) : (
          <table>
            <tbody>
              {c.contacts.map((t, i) => (
                <tr key={i}>
                  <th>{t.at}</th>
                  <td>
                    {t.who} by {t.channel}: {t.outcome}
                    {t.note ? `. ${t.note}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h2>Amount outstanding</h2>
        <p>{c.outstanding}</p>

        <h2>Requested action</h2>
        <p>{c.request}</p>

        <p className="muted">{c.privacy}</p>

        <p style={{ marginTop: 28 }}>Respectfully,</p>
        <div style={{ marginTop: 42 }}>
          <div>____________________________</div>
          <div>
            <b>{c.signatory.name}</b>
          </div>
          <div>
            {c.signatory.title}, {c.signatory.organisation}
          </div>
        </div>

        <h2>Attachments</h2>
        {c.attachments.length === 0 ? (
          <p className="muted">None.</p>
        ) : (
          <ol>
            {c.attachments.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

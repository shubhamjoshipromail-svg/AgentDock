"use client";

import { useState } from "react";

import {
  choicePayloadSchema, formPayloadSchema, confirmationPayloadSchema,
  type ChoicePayload, type FormPayload, type ConfirmationPayload
} from "../../lib/execution/interaction-intent";
import { Button } from "../layout/primitives";

// The CONSTRAINED renderer: a fixed component vocabulary over the validated
// intent schemas. Nothing here interprets HTML/markdown/URLs/code — it renders
// ONLY the whitelisted shapes. A payload that fails validation renders as an
// honest error card, never a best-effort guess.

export type PendingIntent = {
  id: string;
  title: string;
  description: string;
  status: string;
  intentType?: string | null;
  payload?: unknown;
};

export function IntentSurface({
  intent,
  onRespond,
  onResolveApproval
}: {
  intent: PendingIntent;
  onRespond: (intentId: string, response: Record<string, unknown>) => void;
  onResolveApproval: (intentId: string, approved: boolean) => void;
}) {
  const type = intent.intentType ?? "approval";

  if (type === "approval") {
    return (
      <div className="intentCard" data-kind="approval">
        <div className="intentAsking">⚠ Approval required</div>
        <div className="intentTitle">{intent.title}</div>
        <div className="intentDesc">{intent.description.slice(0, 300)}</div>
        <div className="intentActions">
          <Button variant="primary" size="sm" onClick={() => onResolveApproval(intent.id, true)}>✓ Approve &amp; Resume</Button>
          <Button variant="danger" size="sm" onClick={() => onResolveApproval(intent.id, false)}>✗ Deny &amp; Halt</Button>
        </div>
      </div>
    );
  }

  if (type === "choice") {
    const parsed = choicePayloadSchema.safeParse(intent.payload);
    if (!parsed.success) return <InvalidSurface type={type} />;
    return <ChoiceSurface intent={intent} payload={parsed.data} onRespond={onRespond} />;
  }
  if (type === "form") {
    const parsed = formPayloadSchema.safeParse(intent.payload);
    if (!parsed.success) return <InvalidSurface type={type} />;
    return <FormSurface intent={intent} payload={parsed.data} onRespond={onRespond} />;
  }
  if (type === "confirmation") {
    const parsed = confirmationPayloadSchema.safeParse(intent.payload);
    if (!parsed.success) return <InvalidSurface type={type} />;
    return <ConfirmationSurface intent={intent} payload={parsed.data} onRespond={onRespond} />;
  }
  return <InvalidSurface type={type} />;
}

function InvalidSurface({ type }: { type: string }) {
  return (
    <div className="intentCard" data-kind="error">
      <div className="intentAsking">⚠ Invalid surface</div>
      <div className="intentDesc">The agent sent an invalid <code>{type}</code> surface. Nothing is rendered — this is reported honestly rather than guessed.</div>
    </div>
  );
}

function ChoiceSurface({ intent, payload, onRespond }: { intent: PendingIntent; payload: ChoicePayload; onRespond: (id: string, r: Record<string, unknown>) => void }) {
  const max = payload.maxSelect ?? payload.options.length;
  const min = payload.minSelect ?? 1;
  const single = max === 1;
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (id: string) => {
    setSelected((cur) => {
      if (single) return [id];
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (cur.length >= max) return cur; // enforce maxSelect
      return [...cur, id];
    });
  };

  const canSubmit = selected.length >= min && selected.length <= max;
  return (
    <div className="intentCard" data-kind="choice">
      <div className="intentAsking">🙋 The agent is asking you</div>
      <div className="intentTitle">{payload.prompt}</div>
      <div className="intentOptions">
        {payload.options.map((o) => (
          <button
            key={o.id}
            type="button"
            className="intentOption"
            data-selected={selected.includes(o.id)}
            onClick={() => toggle(o.id)}
          >
            <span className="intentOptionMark">{selected.includes(o.id) ? (single ? "◉" : "☑") : (single ? "◯" : "☐")}</span>
            <span className="intentOptionBody">
              <span className="intentOptionTitle">{o.title}</span>
              {o.description && <span className="intentOptionDesc">{o.description}</span>}
            </span>
          </button>
        ))}
      </div>
      <div className="intentHint">{single ? "Pick one." : `Pick ${min === max ? max : `${min}–${max}`}.`}</div>
      <div className="intentActions">
        <Button variant="primary" size="sm" onClick={() => onRespond(intent.id, { selectedIds: selected })} disabled={!canSubmit}>Submit</Button>
      </div>
    </div>
  );
}

function FormSurface({ intent, payload, onRespond }: { intent: PendingIntent; payload: FormPayload; onRespond: (id: string, r: Record<string, unknown>) => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const set = (name: string, v: string) => setValues((cur) => ({ ...cur, [name]: v }));
  const missingRequired = payload.fields.some((f) => f.required && !(values[f.name] ?? "").trim());

  const submit = () => {
    const out: Record<string, string | number> = {};
    for (const f of payload.fields) {
      const raw = values[f.name];
      if (raw === undefined || raw === "") continue;
      out[f.name] = f.type === "number" ? Number(raw) : raw;
    }
    onRespond(intent.id, { values: out });
  };

  return (
    <div className="intentCard" data-kind="form">
      <div className="intentAsking">🙋 The agent is asking you</div>
      <div className="intentTitle">{payload.prompt}</div>
      <div className="intentFields">
        {payload.fields.map((f) => (
          <label className="intentField" key={f.name}>
            <span className="intentFieldLabel">{f.label}{f.required ? " *" : ""}</span>
            {f.type === "select" ? (
              <select className="field" value={values[f.name] ?? ""} onChange={(e) => set(f.name, e.target.value)}>
                <option value="">Select…</option>
                {(f.options ?? []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            ) : (
              <input
                className="field"
                type={f.type === "number" ? "number" : "text"}
                value={values[f.name] ?? ""}
                onChange={(e) => set(f.name, e.target.value)}
              />
            )}
          </label>
        ))}
      </div>
      <div className="intentActions">
        <Button variant="primary" size="sm" onClick={submit} disabled={missingRequired}>Submit</Button>
      </div>
    </div>
  );
}

function ConfirmationSurface({ intent, payload, onRespond }: { intent: PendingIntent; payload: ConfirmationPayload; onRespond: (id: string, r: Record<string, unknown>) => void }) {
  return (
    <div className="intentCard" data-kind="confirmation">
      <div className="intentAsking">🙋 The agent is asking you</div>
      <div className="intentTitle">{payload.prompt}</div>
      {payload.context && <div className="intentDesc">{payload.context}</div>}
      <div className="intentActions">
        <Button variant="primary" size="sm" onClick={() => onRespond(intent.id, { confirmed: true })}>Proceed</Button>
        <Button variant="ghost" size="sm" onClick={() => onRespond(intent.id, { confirmed: false })}>Abort</Button>
      </div>
    </div>
  );
}

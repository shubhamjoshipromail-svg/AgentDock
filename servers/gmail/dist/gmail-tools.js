"use strict";
// First-party Gmail tool logic, isolated from the MCP wiring so it can be unit
// tested with a mocked Gmail API (no real network, no real send). The narrow
// GmailApi interface is structurally satisfied by google.gmail("v1").
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildRawMessage = buildRawMessage;
exports.createDraft = createDraft;
exports.sendEmail = sendEmail;
// Build an RFC 822 message and base64url-encode it the way the Gmail API expects.
function buildRawMessage({ to, subject, body }) {
    const headers = [
        `To: ${to}`,
        `Subject: ${subject}`,
        "MIME-Version: 1.0",
        'Content-Type: text/plain; charset="UTF-8"'
    ];
    const message = `${headers.join("\r\n")}\r\n\r\n${body}`;
    return Buffer.from(message, "utf-8").toString("base64url");
}
// Safe: writes only to the user's own Drafts. No external side effect.
async function createDraft(gmail, input) {
    const raw = buildRawMessage(input);
    await gmail.users.drafts.create({ userId: "me", requestBody: { message: { raw } } });
    return `Draft created in your mailbox — to ${input.to}, subject "${input.subject}". Not sent.`;
}
// External write: actually sends mail from the user's account. AgentDock gates
// this behind approval; the server itself just performs the send when called.
async function sendEmail(gmail, input) {
    const raw = buildRawMessage(input);
    await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
    return `Email sent — to ${input.to}, subject "${input.subject}".`;
}

import type { CompanySummary, Contract, ProjectAgent, Snapshot, SystemInfo } from '../../shared/types.ts';

export interface FileEntry {
  path: string;
  size: number;
  mtime: number;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Der Server antwortet mit ${res.status}.`);
  return data as T;
}

/** DELETE ohne Rumpf, aber mit JSON-Kennung, damit die API die Anfrage annimmt. */
async function requestDelete<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Der Server antwortet mit ${res.status}.`);
  return data as T;
}

const base = (id: string) => `/api/companies/${encodeURIComponent(id)}`;

export const api = {
  system: () => request<SystemInfo>('GET', '/api/system'),
  refreshSystem: () => request<SystemInfo>('POST', '/api/system'),
  companies: () => request<CompanySummary[]>('GET', '/api/companies'),
  createCompany: (body: unknown) => request<{ id: string }>('POST', '/api/companies', body),
  patchCompany: (id: string, body: unknown) => request<Snapshot>('PATCH', base(id), body),
  hire: (id: string, body: unknown) => request('POST', `${base(id)}/agents`, body),
  chat: (id: string, agentId: string, text: string, expectNotes = false) => request('POST', `${base(id)}/agents/${agentId}/chat`, { text, expectNotes }),
  startOrder: (id: string, body: unknown) => request<{ id: string }>('POST', `${base(id)}/orders`, body),
  stopOrder: (id: string, orderId: string) => request('POST', `${base(id)}/orders/${orderId}/stop`, {}),
  revise: (id: string, orderId: string, body: unknown) => request('POST', `${base(id)}/orders/${orderId}/revise`, body),
  decide: (id: string, orderId: string, body: unknown) => request('POST', `${base(id)}/orders/${orderId}/decide`, body),
  startMeeting: (id: string, body: unknown) => request<{ id: string }>('POST', `${base(id)}/meetings`, body),
  stopMeeting: (id: string, meetingId: string) => request('POST', `${base(id)}/meetings/${meetingId}/stop`, {}),
  resumeMeeting: (id: string, meetingId: string, body: unknown) => request('POST', `${base(id)}/meetings/${meetingId}/resume`, body),
  decideMeeting: (id: string, meetingId: string, decision: string) => request('POST', `${base(id)}/meetings/${meetingId}/decide`, { decision }),
  stopRun: (id: string, runId: string) => request('POST', `${base(id)}/runs/${runId}/stop`, {}),
  decideCommand: (id: string, commandId: string, body: unknown) => request('POST', `${base(id)}/commands/${commandId}/decide`, body),
  stopCommand: (id: string, commandId: string) => request('POST', `${base(id)}/commands/${commandId}/stop`, {}),
  projectAgents: (id: string) => request<ProjectAgent[]>('GET', `${base(id)}/project-agents`),
  adoptProjectAgent: (id: string, body: unknown) => request('POST', `${base(id)}/project-agents`, body),
  updateJob: (id: string, agentId: string, body: unknown) => request('PATCH', `${base(id)}/agents/${agentId}`, body),
  addAgentSkill: (id: string, agentId: string, body: unknown) => request('POST', `${base(id)}/agents/${agentId}/skills`, body),
  fireAgent: (id: string, agentId: string) => request('POST', `${base(id)}/agents/${agentId}/fire`, {}),
  expandBuilding: (id: string, body: unknown) => request('POST', `${base(id)}/building`, body),
  addShaft: (id: string, body: unknown) => request('POST', `${base(id)}/building/shaft`, body),
  updateCeo: (id: string, body: unknown) => request('PATCH', `${base(id)}/ceo`, body),
  createNote: (id: string, body: unknown) => request('POST', `${base(id)}/board`, body),
  updateNote: (id: string, noteId: string, body: unknown) => request('PATCH', `${base(id)}/board/${noteId}`, body),
  laterNote: (id: string, noteId: string) => request('POST', `${base(id)}/board/${noteId}/later`, {}),
  backToBoard: (id: string, noteId: string) => request('POST', `${base(id)}/board/${noteId}/back`, {}),
  planSprint: (id: string, body: unknown) => request('POST', `${base(id)}/sprints`, body),
  sprintAction: (id: string, sprintId: string, action: 'start' | 'discard' | 'end' | 'retro' | 'close', body: unknown = {}) => request('POST', `${base(id)}/sprints/${sprintId}/${action}`, body),
  unsprintNote: (id: string, sprintId: string, noteId: string) => request('DELETE', `${base(id)}/sprints/${sprintId}/notes/${noteId}`),
  addConnection: (body: unknown) => request('POST', '/api/settings/connections', body),
  removeConnection: (id: string) => requestDelete(`/api/settings/connections/${id}`),
  addConnectionModel: (id: string, body: unknown) => request('POST', `/api/settings/connections/${id}/models`, body),
  removeConnectionModel: (id: string, remote: string) => requestDelete(`/api/settings/connections/${id}/models/${encodeURIComponent(remote)}`),
  connectRepo: (id: string, source: string) => request('POST', `${base(id)}/repo`, { source }),
  disconnectRepo: (id: string) => requestDelete(`${base(id)}/repo`),
  orderDiff: (id: string, orderId: string) => request<{ diff: string }>('GET', `${base(id)}/orders/${orderId}/diff`),
  pushOrder: (id: string, orderId: string) => request('POST', `${base(id)}/orders/${orderId}/push`, {}),
  openOrderPr: (id: string, orderId: string) => request('POST', `${base(id)}/orders/${orderId}/pr`, {}),
  dropNote: (id: string, noteId: string) => request('POST', `${base(id)}/board/${noteId}/drop`, {}),
  createRole: (id: string, body: unknown) => request<{ id: string }>('POST', `${base(id)}/roles`, body),
  updateRole: (id: string, roleId: string, body: unknown) => request('PATCH', `${base(id)}/roles/${roleId}`, body),
  deleteRole: (id: string, roleId: string) => requestDelete(`${base(id)}/roles/${roleId}`),
  createTeam: (id: string, body: unknown) => request<{ id: string }>('POST', `${base(id)}/teams`, body),
  updateTeam: (id: string, teamId: string, body: unknown) => request('PATCH', `${base(id)}/teams/${teamId}`, body),
  deleteTeam: (id: string, teamId: string) => requestDelete(`${base(id)}/teams/${teamId}`),
  townAction: (id: string, parcelId: string, body: unknown) => request('POST', `${base(id)}/town/${parcelId}`, body),
  createDepartment: (id: string, body: unknown) => request<{ id: string }>('POST', `${base(id)}/departments`, body),
  patchDepartment: (id: string, departmentId: string, body: unknown) => request('PATCH', `${base(id)}/departments/${departmentId}`, body),
  dissolveDepartment: (id: string, departmentId: string) => requestDelete(`${base(id)}/departments/${departmentId}`),
  startMandate: (id: string, body: unknown) => request<{ id: string }>('POST', `${base(id)}/mandates`, body),
  planMandate: (id: string, mandateId: string) => request('POST', `${base(id)}/mandates/${mandateId}/plan`, {}),
  closeMandate: (id: string, mandateId: string) => request('POST', `${base(id)}/mandates/${mandateId}/close`, {}),
  decideProposal: (id: string, mandateId: string, proposalId: string, decision: string) =>
    request('POST', `${base(id)}/mandates/${mandateId}/proposals/${proposalId}`, { decision }),
  contract: (id: string, mandateId: string, contractId: string) => request<{ contract: Contract; text: string }>('GET', `${base(id)}/mandates/${mandateId}/contracts/${contractId}`),
  signContract: (id: string, mandateId: string, contractId: string, body: unknown) => request('POST', `${base(id)}/mandates/${mandateId}/contracts/${contractId}`, body),
  placeItem: (id: string, body: unknown) => request('POST', `${base(id)}/items`, body),
  moveItem: (id: string, itemId: string, body: unknown) => request('PATCH', `${base(id)}/items/${itemId}`, body),
  storeItem: (id: string, itemId: string) => request('POST', `${base(id)}/items/${itemId}/store`, {}),
  deleteItem: (id: string, itemId: string) => requestDelete(`${base(id)}/items/${itemId}`),
  files: (id: string) => request<FileEntry[]>('GET', `${base(id)}/files`),
  reveal: (id: string, path: string) => request('POST', `${base(id)}/reveal`, { path }),
  streamUrl: (id: string) => `${base(id)}/stream`,
  fileUrl: (id: string, path: string, download = false) => `${base(id)}/file?path=${encodeURIComponent(path)}${download ? '&download=1' : ''}`,
  logUrl: (id: string, runId: string) => `${base(id)}/runs/${runId}/log`,
  artifactUrl: (port: number, id: string, path: string) =>
    `${location.protocol}//${location.hostname}:${port}/${encodeURIComponent(id)}/${path.split('/').map(encodeURIComponent).join('/')}`,
};

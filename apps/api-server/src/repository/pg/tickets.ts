import { randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import type {
  AddTicketReplyInput,
  AdminTicketFilter,
  CreateTicketInput,
  FeedbackTicket,
  FeedbackTicketReply,
  TicketCategory,
  TicketPriority,
  TicketStats,
  TicketStatus,
} from '../types';

function makeTicketId(): string {
  const now = new Date();
  const y = now.getFullYear().toString().slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rnd = randomBytes(2).toString('hex').toUpperCase();
  return `TK${y}${m}${d}-${rnd}`;
}

interface TicketDbRow {
  id: string;
  user_id: string;
  username: string;
  nickname: string;
  category: string;
  priority: string;
  status: string;
  title: string;
  content: string;
  contact: string;
  attachment: string | null;
  client_info: string;
  admin_note: string;
  has_unread_reply: boolean;
  reply_count?: string | number;
  created_at: Date;
  updated_at: Date;
}

interface ReplyDbRow {
  id: string;
  ticket_id: string;
  sender_role: string;
  sender_name: string;
  content: string;
  created_at: Date;
}

function mapTicketRow(row: TicketDbRow, includeAttachment = false): FeedbackTicket {
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username ?? '',
    nickname: row.nickname ?? '玩家',
    category: (row.category || 'bug') as TicketCategory,
    priority: (row.priority || 'normal') as TicketPriority,
    status: (row.status || 'open') as TicketStatus,
    title: row.title,
    content: row.content,
    contact: row.contact ?? '',
    attachment: includeAttachment ? (row.attachment ?? null) : row.attachment ? '[image]' : null,
    clientInfo: row.client_info ?? '',
    adminNote: row.admin_note ?? '',
    hasUnreadReply: Boolean(row.has_unread_reply),
    replyCount: Number(row.reply_count ?? 0),
    createdAt: row.created_at.getTime(),
    updatedAt: row.updated_at.getTime(),
  };
}

function mapReplyRow(row: ReplyDbRow): FeedbackTicketReply {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    senderRole: row.sender_role === 'gm' ? 'gm' : 'player',
    senderName: row.sender_name,
    content: row.content,
    createdAt: row.created_at.getTime(),
  };
}

export async function createTicket(pool: pg.Pool, input: CreateTicketInput): Promise<FeedbackTicket> {
  const id = makeTicketId();
  const res = await pool.query<TicketDbRow>(
    `insert into feedback_tickets
       (id, user_id, username, nickname, category, priority, status, title, content, contact, attachment, client_info)
     values ($1, $2, $3, $4, $5, $6, 'open', $7, $8, $9, $10, $11)
     returning *, 0::int as reply_count`,
    [
      id,
      input.userId,
      input.username,
      input.nickname,
      input.category,
      input.priority,
      input.title,
      input.content,
      input.contact,
      input.attachment,
      input.clientInfo,
    ],
  );
  return { ...mapTicketRow(res.rows[0]!, true), replies: [] };
}

export async function listPlayerTickets(
  pool: pg.Pool,
  userId: string,
  limit = 50,
): Promise<FeedbackTicket[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const res = await pool.query<TicketDbRow>(
    `select t.*,
            (select count(*) from feedback_ticket_replies r where r.ticket_id = t.id) as reply_count
       from feedback_tickets t
      where t.user_id = $1
      order by t.updated_at desc
      limit $2`,
    [userId, safeLimit],
  );
  return res.rows.map((r) => mapTicketRow(r, false));
}

export async function getTicketDetail(pool: pg.Pool, ticketId: string): Promise<FeedbackTicket | null> {
  const tRes = await pool.query<TicketDbRow>(
    `select t.*,
            (select count(*) from feedback_ticket_replies r where r.ticket_id = t.id) as reply_count
       from feedback_tickets t
      where t.id = $1`,
    [ticketId],
  );
  const row = tRes.rows[0];
  if (!row) return null;

  const rRes = await pool.query<ReplyDbRow>(
    `select * from feedback_ticket_replies where ticket_id = $1 order by created_at asc`,
    [ticketId],
  );
  const ticket = mapTicketRow(row, true);
  ticket.replies = rRes.rows.map(mapReplyRow);
  ticket.replyCount = ticket.replies.length;
  return ticket;
}

export async function markTicketReadByPlayer(
  pool: pg.Pool,
  ticketId: string,
  userId: string,
): Promise<void> {
  await pool.query(
    `update feedback_tickets set has_unread_reply = false where id = $1 and user_id = $2`,
    [ticketId, userId],
  );
}

export async function addTicketReply(
  pool: pg.Pool,
  input: AddTicketReplyInput,
): Promise<FeedbackTicketReply> {
  const id = randomUUID();
  const res = await pool.query<ReplyDbRow>(
    `insert into feedback_ticket_replies (id, ticket_id, sender_role, sender_name, content)
     values ($1, $2, $3, $4, $5)
     returning *`,
    [id, input.ticketId, input.senderRole, input.senderName, input.content],
  );

  if (input.senderRole === 'gm') {
    const nextStatus = input.nextStatus ?? 'replied';
    await pool.query(
      `update feedback_tickets
          set status = $2, has_unread_reply = true, updated_at = now()
        where id = $1`,
      [input.ticketId, nextStatus],
    );
  } else {
    const nextStatus = input.nextStatus ?? 'open';
    await pool.query(
      `update feedback_tickets
          set status = case when status in ('replied', 'resolved') then $2 else status end,
              has_unread_reply = false,
              updated_at = now()
        where id = $1`,
      [input.ticketId, nextStatus],
    );
  }

  return mapReplyRow(res.rows[0]!);
}

export async function updateTicketStatus(
  pool: pg.Pool,
  ticketId: string,
  status: TicketStatus,
  adminNote?: string,
): Promise<FeedbackTicket | null> {
  const res = await pool.query<TicketDbRow>(
    `update feedback_tickets
        set status = $2,
            admin_note = coalesce($3, admin_note),
            updated_at = now()
      where id = $1
      returning *,
        (select count(*) from feedback_ticket_replies r where r.ticket_id = feedback_tickets.id) as reply_count`,
    [ticketId, status, adminNote !== undefined ? adminNote : null],
  );
  if (!res.rows[0]) return null;
  return mapTicketRow(res.rows[0], true);
}

export async function listAdminTickets(
  pool: pg.Pool,
  filter: AdminTicketFilter = {},
): Promise<{ tickets: FeedbackTicket[]; stats: TicketStats }> {
  const statsRes = await pool.query<{ status: string; cnt: string }>(
    `select status, count(*)::text as cnt from feedback_tickets group by status`,
  );
  const stats: TicketStats = { total: 0, open: 0, inProgress: 0, replied: 0, resolved: 0, closed: 0 };
  for (const row of statsRes.rows) {
    const n = Number(row.cnt) || 0;
    stats.total += n;
    if (row.status === 'open') stats.open = n;
    else if (row.status === 'in_progress') stats.inProgress = n;
    else if (row.status === 'replied') stats.replied = n;
    else if (row.status === 'resolved') stats.resolved = n;
    else if (row.status === 'closed') stats.closed = n;
  }

  const conds: string[] = [];
  const params: unknown[] = [];
  if (filter.status && filter.status !== 'all') {
    params.push(filter.status);
    conds.push(`t.status = $${params.length}`);
  }
  if (filter.category && filter.category !== 'all') {
    params.push(filter.category);
    conds.push(`t.category = $${params.length}`);
  }
  if (filter.keyword && filter.keyword.trim()) {
    params.push(`%${filter.keyword.trim()}%`);
    const p = `$${params.length}`;
    conds.push(`(t.id ilike ${p} or t.title ilike ${p} or t.content ilike ${p} or t.nickname ilike ${p} or t.username ilike ${p})`);
  }

  const where = conds.length > 0 ? `where ${conds.join(' and ')}` : '';
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 300);
  params.push(limit);

  const res = await pool.query<TicketDbRow>(
    `select t.*,
            (select count(*) from feedback_ticket_replies r where r.ticket_id = t.id) as reply_count
       from feedback_tickets t
       ${where}
      order by
        case t.status when 'open' then 0 when 'in_progress' then 1 when 'replied' then 2 when 'resolved' then 3 else 4 end,
        t.updated_at desc
      limit $${params.length}`,
    params,
  );
  return {
    tickets: res.rows.map((r) => mapTicketRow(r, false)),
    stats,
  };
}

export async function deleteTicket(pool: pg.Pool, ticketId: string): Promise<boolean> {
  const res = await pool.query(`delete from feedback_tickets where id = $1`, [ticketId]);
  return (res.rowCount ?? 0) > 0;
}

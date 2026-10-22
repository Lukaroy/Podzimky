"use client";

import { MessageCircle, Send, X } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type SupportMessage = {
  id: string;
  teamId: string;
  teamName: string;
  senderRole: "team" | "admin";
  content: string;
  createdAt: string;
};

export function SupportChat({
  role,
  teamId,
}: {
  role: "team" | "admin";
  teamId?: string;
}) {
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [isOpen, setIsOpen] = useState(role === "admin");
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const loadMessages = useCallback(async () => {
    const response = await fetch("/api/support", { cache: "no-store" });
    const result = await response.json() as { messages?: SupportMessage[]; error?: string };
    if (!response.ok || !result.messages) {
      throw new Error(result.error ?? "Zprávy se nepodařilo načíst.");
    }
    setMessages(result.messages);
    setError("");
  }, []);

  useEffect(() => {
    let isMounted = true;
    const refresh = async () => {
      try {
        await loadMessages();
      } catch (loadError) {
        if (isMounted) {
          setError(loadError instanceof Error ? loadError.message : "Zprávy se nepodařilo načíst.");
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    void refresh();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 5_000);
    return () => {
      isMounted = false;
      window.clearInterval(interval);
    };
  }, [loadMessages]);

  const conversations = useMemo(() => {
    const grouped = new Map<string, SupportMessage[]>();
    for (const message of messages) {
      const thread = grouped.get(message.teamId) ?? [];
      thread.push(message);
      grouped.set(message.teamId, thread);
    }
    return [...grouped.entries()]
      .map(([id, thread]) => ({ id, name: thread.at(-1)?.teamName ?? "Tým", thread }))
      .sort((first, second) =>
        (second.thread.at(-1)?.createdAt ?? "").localeCompare(first.thread.at(-1)?.createdAt ?? ""),
      );
  }, [messages]);

  const activeTeamId = conversations.some((conversation) => conversation.id === selectedTeamId)
    ? selectedTeamId
    : conversations[0]?.id ?? "";

  const visibleMessages = useMemo(
    () => role === "team"
      ? messages.filter((message) => message.teamId === teamId)
      : conversations.find((conversation) => conversation.id === activeTeamId)?.thread ?? [],
    [activeTeamId, conversations, messages, role, teamId],
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [visibleMessages]);

  const submitMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.trim() || isSending) return;

    setIsSending(true);
    setError("");
    try {
      const response = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: draft,
          ...(role === "admin" ? { teamId: activeTeamId } : {}),
        }),
      });
      const result = await response.json() as { message?: SupportMessage; error?: string };
      const message = result.message;
      if (!response.ok || !message) {
        throw new Error(result.error ?? "Zprávu se nepodařilo odeslat.");
      }
      setMessages((current) => [...current, message]);
      setDraft("");
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Zprávu se nepodařilo odeslat.");
    } finally {
      setIsSending(false);
    }
  };

  const panel = (
    <section className="flex h-full min-h-0 flex-col bg-[#fffdfa] text-[#30251e]" aria-label="Podpora">
      <header className="flex items-center justify-between border-b border-[#eee5d6] px-4 py-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#8e5d1d]">
            {role === "admin" ? "Podpora účastníků" : "Podpora"}
          </p>
          <h2 className="text-lg font-bold">{role === "admin" ? "Zprávy týmů" : "Napište pořadateli"}</h2>
        </div>
        {role === "team" && (
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            aria-label="Zavřít podporu"
            className="rounded-lg p-2 text-[#675d53] hover:bg-[#f5efe8]"
          >
            <X size={18} />
          </button>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        {role === "admin" && (
          <nav aria-label="Konverzace týmů" className="w-40 shrink-0 overflow-y-auto border-r border-[#eee5d6] sm:w-52">
            {conversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                onClick={() => setSelectedTeamId(conversation.id)}
                aria-current={activeTeamId === conversation.id ? "true" : undefined}
                className={`block w-full border-b border-[#f0e9de] px-3 py-3 text-left text-sm hover:bg-[#f8f3ea] ${
                  activeTeamId === conversation.id ? "bg-[#f5eddd] font-bold" : ""
                }`}
              >
                <span className="block truncate">{conversation.name}</span>
                <span className="mt-1 block truncate text-xs font-normal text-[#756958]">
                  {conversation.thread.at(-1)?.content}
                </span>
              </button>
            ))}
          </nav>
        )}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
            {isLoading ? (
              <p className="text-sm text-[#756958]">Načítám zprávy…</p>
            ) : visibleMessages.length === 0 ? (
              <p className="rounded-xl bg-[#f5efe8] p-3 text-sm text-[#675d53]">
                {role === "admin" ? "Zatím tu nejsou žádné konverzace." : "Zatím tu nejsou žádné zprávy. Napište nám."}
              </p>
            ) : visibleMessages.map((message) => (
              <article
                key={message.id}
                className={`max-w-[90%] rounded-2xl px-3 py-2 ${
                  message.senderRole === role
                    ? "ml-auto bg-[#f5eddd]"
                    : "mr-auto bg-[#f1f3f4]"
                }`}
              >
                <p className="mb-1 text-[11px] font-bold text-[#795b42]">
                  {message.senderRole === "team" ? message.teamName : "Pořadatel"}
                </p>
                <p className="whitespace-pre-wrap break-words text-sm">{message.content}</p>
                <time className="mt-1 block text-right text-[10px] text-[#756958]" dateTime={message.createdAt}>
                  {new Date(message.createdAt).toLocaleString("cs-CZ")}
                </time>
              </article>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {error && <p role="alert" className="px-4 pb-2 text-sm text-[#8b2d2d]">{error}</p>}
          <form onSubmit={submitMessage} className="border-t border-[#eee5d6] p-3">
            <label className="sr-only" htmlFor={`support-message-${role}`}>Zpráva</label>
            <textarea
              id={`support-message-${role}`}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={2_000}
              rows={2}
              disabled={isSending || (role === "admin" && !activeTeamId)}
              placeholder={role === "admin" ? "Odpovědět týmu…" : "S čím vám můžeme pomoci?"}
              className="w-full resize-none rounded-xl border border-[#d8c6a2] bg-white p-3 text-sm outline-none focus:ring-2 focus:ring-[#d59a39]/30 disabled:opacity-60"
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-xs text-[#756958]">{draft.length}/2 000</span>
              <button
                type="submit"
                disabled={isSending || !draft.trim() || (role === "admin" && !activeTeamId)}
                className="inline-flex items-center gap-2 rounded-xl bg-[#7d4d19] px-4 py-2 text-sm font-bold text-white hover:bg-[#633b12] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send size={15} /> {isSending ? "Odesílám…" : "Odeslat"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );

  if (role === "admin") {
    return <div className="h-[min(72vh,760px)] overflow-hidden rounded-2xl border border-[#e3d9c9] shadow-[0_8px_22px_rgba(25,19,12,0.05)]">{panel}</div>;
  }

  return (
    <div className="fixed bottom-4 right-4 z-40">
      {isOpen ? (
        <div className="h-[min(70vh,560px)] w-[min(92vw,400px)] overflow-hidden rounded-2xl border border-[#e3d9c9] shadow-[0_16px_45px_rgba(25,19,12,0.22)]">
          {panel}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="flex items-center gap-2 rounded-full bg-[#7d4d19] px-5 py-3 font-bold text-white shadow-lg hover:bg-[#633b12]"
        >
          <MessageCircle size={19} /> Podpora
        </button>
      )}
    </div>
  );
}

"use client";

import type { Html5Qrcode as Html5QrcodeInstance } from "html5-qrcode";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import Image from "next/image";
import {
  ArrowLeft,
  ArrowRight,
  Activity,
  AlertTriangle,
  Camera,
  CheckCircle2,
  Check,
  Clock,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Download,
  Eye,
  EyeOff,
  Images,
  LogOut,
  MapPin,
  MessageCircle,
  Plus,
  QrCode,
  ScanLine,
  Pause,
  Play,
  Trash2,
  Users,
  X,
  Zap,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { createPortal } from "react-dom";
import { type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { getFirebaseAuth } from "@/lib/firebase-client";
import { SupportChat } from "@/app/SupportChat";

type StationType =
  | "photo"
  | "video"
  | "text"
  | "number"
  | "multiple-choice"
  | "riddle"
  | "form";

type SubmissionStatus = "pending" | "approved" | "rejected";
type Screen = "team-login" | "admin-login" | "team-dashboard" | "admin-panel";
type AuthVisualMode = "sunset" | "interior" | "lanterns";
type AdminTab = "teams" | "stations" | "submissions" | "media" | "flash" | "managers" | "live" | "support";

const WALLPAPERS = [
  { id: "parchment", label: "Pergamen" },
  { id: "mist", label: "Mlžné hory" },
  { id: "bamboo", label: "Bambus" },
  { id: "night", label: "Noční tuš" },
  { id: "cinnabar", label: "Cinobr" },
  { id: "sakura", label: "Sakura" },
  { id: "sunrise", label: "Východ slunce" },
  { id: "seigaiha", label: "Vlny" },
  { id: "forest", label: "Hluboký les" },
  { id: "plum", label: "Švestkový soumrak" },
  { id: "sumi", label: "Sumi tuš" },
  { id: "gold", label: "Zlatý lak" },
] as const;
type Wallpaper = (typeof WALLPAPERS)[number]["id"];

// Pozadí plochy se pamatuje v prohlížeči; změna se oznamuje vlastní událostí.
function subscribeWallpaper(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("podzimky-wallpaper", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("podzimky-wallpaper", callback);
  };
}
function readWallpaper(): Wallpaper {
  const saved = window.localStorage.getItem("podzimky-wallpaper");
  return WALLPAPERS.find((item) => item.id === saved)?.id ?? "parchment";
}

const ADMIN_TAB_TITLES: Record<AdminTab, string> = {
  teams: "Týmy",
  stations: "Stanoviště",
  submissions: "Schvalování",
  media: "Galerie",
  flash: "Přepady",
  managers: "Správci",
  live: "Živý přehled",
  support: "Podpora",
};

// Sleduje, zda je okno dost široké pro režim plochy s plovoucími okny.
function subscribeDesktop(callback: () => void) {
  const query = window.matchMedia("(min-width: 900px)");
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

type TeamQrCard = {
  id: string;
  teamId: string | null;
  createdAt: string;
};

const authVisualBackgrounds: Record<AuthVisualMode, string> = {
  sunset: "/podzimky-palace-sunset-hd.jpg",
  interior: "/podzimky-palace-interior-hd.jpg",
  lanterns: "/podzimky-mid-autumn-desktop.jpeg",
};

type Station = {
  id: string;
  order: number;
  title: string;
  uid: string;
  description: string;
  clue: string;
  task: string;
  type: StationType;
  requiresApproval: boolean;
  isDraft?: boolean;
  instructions?: string;
  options?: string[];
  answer?: string;
  image?: string;
  formQuestions?: Array<{
    id: string;
    label: string;
    type: "text" | "number" | "multiple-choice";
    options?: string[];
    answer?: string;
  }>;
};

type Submission = {
  id: string;
  stationId: string;
  missionId?: string;
  teamId: string;
  status: SubmissionStatus;
  content: string;
  evidence: string;
  mediaUrl?: string;
  comment: string;
  createdAt: string;
  archivedAt?: string;
};

type Team = {
  id: string;
  name: string;
  password: string;
  completedStations: string[];
  scannedStationIds: string[];
  progressVersion?: number;
  flashMissionId?: string;
  flashMissionsUsed?: number;
};

type FlashMission = {
  id: string;
  title: string;
  description: string;
  type: StationType;
  targetMode: "all" | "specific";
  targetTeamIds: string[];
  requiresApproval: boolean;
  instructions: string;
  sourceTeamId?: string;
  sourceTeamName?: string;
  archivedAt?: string;
};

type GameEvent = {
  id: string;
  teamId?: string;
  message: string;
  tone: "info" | "success" | "warning";
  createdAt: string;
};

type GameResult = {
  teamId: string;
  teamName: string;
  completedStations: number;
  rank: number;
};

type GameState = {
  stations: Station[];
  teams: Team[];
  submissions: Submission[];
  flashMissions: FlashMission[];
  events: GameEvent[];
  gameStartedAt?: string;
  gameStoppedAt?: string;
  gamePausedMs?: number;
  emergencyMessage?: { message: string; createdAt: string };
  gameClosedAt?: string;
  gameResults?: GameResult[];
  ambushTargets?: Array<{ id: string; name: string }>;
};

const emptyGameState: GameState = {
  stations: [],
  teams: [],
  submissions: [],
  flashMissions: [],
  events: [],
  gameStartedAt: undefined,
  gameStoppedAt: undefined,
  gamePausedMs: 0,
  gameResults: undefined,
};

// Určí pořadí dalšího stanoviště podle již dokončených úkolů týmu.
function getNextOrder(team: Team | null | undefined, stations: Station[]): number {
  if (!team) return 1;
  const completedOrders = stations
    .filter((station) => team.completedStations.includes(station.id))
    .map((station) => station.order);

  return Math.max(...completedOrders, 0) + 1;
}

// Bezpečně najde stanoviště jen tehdy, když máme jeho ID.
function getStationById(stations: Station[], stationId?: string | null) {
  if (!stationId) return undefined;
  return stations.find((station) => station.id === stationId);
}

function createTeamLoginUrl(token: string): string {
  const url = new URL(window.location.origin);
  url.searchParams.set("team-login", token);
  return url.toString();
}

// Sestaví CSS třídy a vynechá nepoužité podmíněné hodnoty.
function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

// Vykreslí přístupné modální okno s jednotným zavíráním klávesou Escape.
function AdminDialog({
  title,
  description,
  onClose,
  variant = "dialog",
  children,
}: {
  title: string;
  description: string;
  onClose: () => void;
  variant?: "dialog" | "drawer";
  children: ReactNode;
}) {
  useEffect(() => {
    // Zavře dialog klávesou Escape a při odpojení odstraní posluchač.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const windowRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; dx: number; dy: number } | null>(null);

  // Okno jde přesouvat za titulkovou lištu jako na desktopu.
  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    const element = windowRef.current;
    if (!element) return;
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      dx: Number.parseFloat(element.style.getPropertyValue("--win-dx")) || 0,
      dy: Number.parseFloat(element.style.getPropertyValue("--win-dy")) || 0,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const element = windowRef.current;
    if (!drag || !element) return;
    element.style.setProperty("--win-dx", `${drag.dx + event.clientX - drag.x}px`);
    element.style.setProperty("--win-dy", `${drag.dy + event.clientY - drag.y}px`);
  };
  const endDrag = () => { dragRef.current = null; };

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="admin-dialog-backdrop" />
        <DialogPrimitive.Content ref={windowRef} className={classNames("admin-dialog", variant === "drawer" && "admin-dialog-drawer")}>
        <div className="admin-dialog-titlebar" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
          <DialogPrimitive.Close asChild>
            <button type="button" aria-label="Zavřít okno" className="admin-dialog-dot admin-dialog-dot-close" />
          </DialogPrimitive.Close>
          <span className="admin-dialog-dot admin-dialog-dot-min" aria-hidden="true" />
          <span className="admin-dialog-dot admin-dialog-dot-max" aria-hidden="true" />
          <span className="admin-dialog-titlebar-name" aria-hidden="true">podzimky://{title.toLowerCase().replace(/\s+/g, "-")}</span>
        </div>
        <header className="admin-dialog-header">
          <div className="admin-dialog-seal" aria-hidden="true">印</div>
          <div className="min-w-0 flex-1">
            <p className="admin-eyebrow">Herní dílna</p>
            <DialogPrimitive.Title className="admin-dialog-title">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Description>{description}</DialogPrimitive.Description>
          </div>
          <DialogPrimitive.Close asChild>
            <button type="button" aria-label="Zavřít okno" className="admin-dialog-close"><X size={19} /></button>
          </DialogPrimitive.Close>
        </header>
        {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// Nabídne přepnutí mezi variantami grafického vzhledu přihlášení.
function AuthVisualModePicker({
  mode,
  onChange,
}: {
  mode: AuthVisualMode;
  onChange: (mode: AuthVisualMode) => void;
}) {
  return (
    <div className="auth-mode-switch" role="group" aria-label="Vzhled přihlašovací stránky">
      <button
        type="button"
        className={classNames("auth-mode-option", mode === "sunset" && "auth-mode-option-active")}
        aria-pressed={mode === "sunset"}
        onClick={() => onChange("sunset")}
      >
        Západ slunce
      </button>
      <button
        type="button"
        className={classNames("auth-mode-option", mode === "interior" && "auth-mode-option-active")}
        aria-pressed={mode === "interior"}
        onClick={() => onChange("interior")}
      >
        Chrám zevnitř
      </button>
      <button
        type="button"
        className={classNames("auth-mode-option", mode === "lanterns" && "auth-mode-option-active")}
        aria-pressed={mode === "lanterns"}
        onClick={() => onChange("lanterns")}
      >
        Lampionová noc
      </button>
    </div>
  );
}

// Vybere ikonu administrace podle právě vykreslované sekce.
function AdminIcon({ name }: { name: "teams" | "stations" | "review" | "media" | "flash" | "live" | "support" }) {
  const icons = {
    teams: Users,
    stations: MapPin,
    review: ClipboardCheck,
    media: Images,
    flash: Zap,
    live: Activity,
    support: MessageCircle,
  };
  const Icon = icons[name];
  return <Icon aria-hidden="true" size={18} strokeWidth={1.8} className="shrink-0" />;
}

// Kontroluje očekávaný osmiznakový formát QR UID.
function isValidUid(uid: string) {
  return /^[A-Z0-9]{8}$/i.test(uid.trim());
}

// Vytvoří QR čtečku s načítáním knihovny až v okamžiku použití.
async function createQrScanner(elementId: string): Promise<Html5QrcodeInstance> {
  const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import("html5-qrcode");
  return new Html5Qrcode(elementId, {
    formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
    useBarCodeDetectorIfSupported: true,
    verbose: false,
  });
}

// Ověří, že URL odpovídá cestě média spravované aplikací.
function isStoredMediaUrl(url: string | undefined): url is string {
  return Boolean(url && /^\/api\/media\/team-[A-Za-z0-9_-]{1,128}\/[0-9a-f-]{36}\.(jpg|png|webp|gif|avif|mp4|webm|mov)$/i.test(url));
}

// Zmenší velké fotky před nahráním, aby nezabíraly místo v bezplatném úložišti (Full HD+ kvalita pro projektor, ~1 MB místo několika MB).
async function shrinkImage(file: File): Promise<File> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

// Nahraje ověřený týmový soubor do soukromého Blob úložiště.
async function uploadTeamMedia(originalFile: File, teamId: string) {
  const file = await shrinkImage(originalFile);
  const extensions: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
  };
  const extension = extensions[file.type];
  if (!extension) throw new Error("Nepodporovaný formát souboru.");
  if (file.size === 0 || file.size > 100 * 1024 * 1024) {
    throw new Error("Soubor musí mít velikost do 100 MB. Natočte video ve Full HD (1080p) nebo kratší.");
  }
  const pathname = `team-${teamId}/${crypto.randomUUID()}.${extension}`;
  const multipart = file.size > 4.5 * 1024 * 1024;
  const tokenResponse = await fetch("/api/media/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "blob.generate-client-token",
      payload: { pathname, multipart, clientPayload: null },
    }),
  });
  const tokenResponseBody = await tokenResponse.text();
  let tokenResult: { clientToken?: string; error?: string } = {};
  try {
    tokenResult = JSON.parse(tokenResponseBody) as typeof tokenResult;
  } catch {
    // Preserve the HTTP status when a proxy returns a non-JSON error page.
  }
  if (!tokenResponse.ok || !tokenResult.clientToken) {
    throw new Error(tokenResult.error ?? `Server nevydal oprávnění k nahrávání (HTTP ${tokenResponse.status}).`);
  }

  const { put } = await import("@vercel/blob/client");
  let blob: Awaited<ReturnType<typeof put>>;
  try {
    blob = await put(pathname, file, {
      access: "private",
      token: tokenResult.clientToken,
      contentType: file.type,
      multipart,
    });
  } catch (uploadError) {
    const message = uploadError instanceof Error ? uploadError.message : "";
    throw new Error(`Soubor se nepodařilo uložit do Blob úložiště: ${message || "neznámá chyba"}`);
  }
  const mediaUrl = `/api/media/${blob.pathname}`;
  if (!isStoredMediaUrl(mediaUrl)) throw new Error("Server vrátil neplatný odkaz na soubor.");
  return mediaUrl;
}

// Přepočítá začátek, pauzy a aktuální čas na zobrazený herní čas.
function formatElapsedTime(startedAt: string | undefined, now: number, stoppedAt?: string, pausedMs = 0) {
  if (!startedAt) return "Čeká na start";
  const startTime = Date.parse(startedAt);
  if (!Number.isFinite(startTime)) return "Čas nedostupný";
  const stoppedTime = stoppedAt ? Date.parse(stoppedAt) : NaN;
  const endTime = Number.isFinite(stoppedTime) ? stoppedTime : now;
  const totalSeconds = Math.max(0, Math.floor((endTime - startTime - pausedMs) / 1000));
  const hours = Math.floor(totalSeconds / 3600).toString().padStart(2, "0");
  const minutes = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

// Každou sekundu obnoví hodiny; interval při odpojení komponenty uklidí.
function ElapsedClock({ startedAt, stoppedAt, pausedMs = 0, className = "" }: { startedAt?: string; stoppedAt?: string; pausedMs?: number; className?: string }) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <span className={className}><Clock aria-hidden="true" size={13} /> {formatElapsedTime(startedAt, now, stoppedAt, pausedMs)}{stoppedAt ? " ⏸" : ""}</span>;
}

// Plovoucí okno modulu na ploše: přesouvá se za titulek, mění velikost a jde minimalizovat.
function OsWindow({ id, title, z, active, slot, minimized, onFocus, onClose, onMinimize, children }: {
  id: string; title: string; z: number; active: boolean; slot: number; minimized: boolean;
  onFocus: () => void; onClose: () => void; onMinimize: () => void; children: ReactNode;
}) {
  const [maxed, setMaxed] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [fly, setFly] = useState<{ x: number; y: number } | null>(null);
  const leavingRef = useRef(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [geo, setGeo] = useState(() => {
    const areaW = typeof window === "undefined" ? 1000 : Math.max(window.innerWidth - 330, 520);
    const areaH = typeof window === "undefined" ? 640 : Math.max(window.innerHeight - 170, 380);
    const first = slot === 0;
    return {
      x: 110 + (slot % 5) * 40,
      y: 12 + (slot % 5) * 34,
      w: Math.min(first ? areaW - 130 : areaW * 0.7, 1200),
      h: Math.min(first ? areaH - 24 : areaH * 0.8, 900),
    };
  });
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  // Okno se "vsákne" do své ikony v doku a teprve potom se zavře nebo minimalizuje.
  const animateOut = (done: () => void) => {
    const element = rootRef.current;
    const target = document.querySelector<HTMLElement>(`[data-dock-tab="${id}"]`);
    if (!element || !target || fly) { done(); return; }
    const from = element.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    setFly({ x: to.left + to.width / 2 - (from.left + from.width / 2), y: to.top + to.height / 2 - (from.top + from.height / 2) });
    window.setTimeout(() => {
      done();
      setFly(null);
      target.animate?.([{ transform: "scale(1)" }, { transform: "scale(1.3)" }, { transform: "scale(1)" }], { duration: 280 });
    }, 300);
  };

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button") || maxed || fly) return;
    drag.current = { px: event.clientX, py: event.clientY, x: geo.x, y: geo.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    const element = rootRef.current;
    const area = element?.parentElement;
    if (!start || !element || !area) return;
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    const x = Math.min(Math.max(start.x + event.clientX - start.px, 24 - width), area.clientWidth - 24);
    const y = Math.min(Math.max(start.y + event.clientY - start.py, 0), area.clientHeight - 34);
    setGeo((current) => ({ ...current, x, y }));
    const visibleW = Math.min(x + width, area.clientWidth) - Math.max(x, 0);
    const visibleH = Math.min(y + height, area.clientHeight) - y;
    const isLeaving = visibleW <= width / 2 || visibleH <= height / 2;
    leavingRef.current = isLeaving;
    setLeaving(isLeaving);
  };
  // Pustíš-li okno, když z něj zbývá jen polovina nebo méně, zavře se do doku.
  const endDrag = () => {
    drag.current = null;
    if (leavingRef.current) {
      leavingRef.current = false;
      setLeaving(false);
      animateOut(onClose);
    }
  };

  return (
    <div
      ref={rootRef}
      className={classNames("os-win", active && "is-active", maxed && "is-max", minimized && "is-min", leaving && "is-leaving", fly && "is-closing")}
      style={{ "--win-x": `${geo.x}px`, "--win-y": `${geo.y}px`, "--win-w": `${geo.w}px`, "--win-h": `${geo.h}px`, "--win-z": z, "--fly-x": `${fly?.x ?? 0}px`, "--fly-y": `${fly?.y ?? 0}px` } as CSSProperties}
      onPointerDown={onFocus}
    >
      <div
        className="os-win-bar"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => setMaxed((value) => !value)}
      >
        <button type="button" className="os-dot os-dot-close" aria-label={`Zavřít ${title}`} onClick={() => animateOut(onClose)} />
        <button type="button" className="os-dot os-dot-min" aria-label={`Minimalizovat ${title}`} onClick={() => animateOut(onMinimize)} />
        <button type="button" className="os-dot os-dot-max" aria-label={`Maximalizovat ${title}`} onClick={() => setMaxed((value) => !value)} />
        <span className="os-win-name">podzimky://{id}</span>
      </div>
      <div className="os-win-body">{children}</div>
    </div>
  );
}

type FlashFormState = {
  title: string;
  description: string;
  type: StationType;
  targets: string;
  targetTeamIds: string[];
  requiresApproval: boolean;
};

// Mobilní konzole správce: přehled týmů, nouzová zpráva, přepady a podpora.
function ManagerConsole({
  gameState, wallpaper, setWallpaper, onLogout, emergencyDraft, setEmergencyDraft, emergencyBusy, onEmergency,
  flashForm, setFlashForm, onLaunchFlash, error, clearError, saving, saveError,
}: {
  gameState: GameState;
  wallpaper: Wallpaper;
  setWallpaper: (next: Wallpaper) => void;
  onLogout: () => void;
  emergencyDraft: string;
  setEmergencyDraft: (value: string) => void;
  emergencyBusy: boolean;
  onEmergency: (action: { action: "emergency-message"; message: string } | { action: "clear-emergency-message" }) => void;
  flashForm: FlashFormState;
  setFlashForm: (updater: (current: FlashFormState) => FlashFormState) => void;
  onLaunchFlash: () => boolean;
  error: string;
  clearError: () => void;
  saving: boolean;
  saveError: string;
}) {
  const [tab, setTab] = useState<"teams" | "alert" | "flash" | "support">("teams");
  const [wallOpen, setWallOpen] = useState(false);
  const [flashOpen, setFlashOpen] = useState(false);
  const stations = [...gameState.stations].sort((first, second) => first.order - second.order);
  const activeMissions = gameState.flashMissions.filter((mission) => !mission.archivedAt);
  const closed = Boolean(gameState.gameClosedAt);
  const status = gameState.gameClosedAt ? "Hra uzavřena" : gameState.gameStoppedAt ? "Pozastaveno" : gameState.gameStartedAt ? "Výprava běží" : "Čeká na start";

  const tabs = [
    { id: "teams" as const, label: "Týmy", icon: <Users size={20} aria-hidden="true" /> },
    { id: "alert" as const, label: "Nouzovka", icon: <AlertTriangle size={20} aria-hidden="true" /> },
    { id: "flash" as const, label: "Přepady", icon: <Zap size={20} aria-hidden="true" /> },
    { id: "support" as const, label: "Podpora", icon: <MessageCircle size={20} aria-hidden="true" /> },
  ];

  return (
    <div className="mgr-app" data-wall={wallpaper}>
      <header className="mgr-top">
        <div className="mgr-brand">
          <span aria-hidden="true">印</span>
          <div>
            <b>Správce</b>
            <small>{status}</small>
          </div>
        </div>
        <ElapsedClock startedAt={gameState.gameStartedAt} stoppedAt={gameState.gameStoppedAt} pausedMs={gameState.gamePausedMs} className="mgr-clock" />
        <button type="button" className="mgr-icon-btn" onClick={() => setWallOpen(true)} aria-label="Změnit tapetu">
          <span className="mgr-wall-dot" aria-hidden="true" />
        </button>
        <button type="button" className="mgr-icon-btn" onClick={onLogout} aria-label="Odhlásit se"><LogOut size={18} aria-hidden="true" /></button>
      </header>

      {gameState.emergencyMessage && tab !== "alert" && (
        <button type="button" className="mgr-banner" onClick={() => setTab("alert")}>
          <AlertTriangle size={16} aria-hidden="true" /> Aktivní nouzová zpráva
        </button>
      )}
      {(saveError || saving) && (
        <p role={saveError ? "alert" : "status"} className={classNames("mgr-save", saveError && "is-error")}>{saveError || "Ukládám změny…"}</p>
      )}

      <main className="mgr-main">
        {tab === "teams" && (
          <section className="mgr-list" aria-label="Stav týmů">
            <div className="mgr-summary">
              <span><b>{gameState.teams.length}</b> týmů</span>
              <span><b>{stations.length}</b> stanovišť</span>
              <span><b>{activeMissions.length}</b> přepadů</span>
            </div>
            {gameState.teams.length === 0 && <p className="mgr-empty">Zatím nejsou vytvořené žádné týmy.</p>}
            {gameState.teams.map((team) => {
              const done = team.completedStations.length;
              const next = stations.find((station) => !team.completedStations.includes(station.id));
              const scanned = next ? team.scannedStationIds.includes(next.id) : false;
              const pending = gameState.submissions.filter((item) => item.teamId === team.id && item.status === "pending" && !item.archivedAt).length;
              const mission = team.flashMissionId ? gameState.flashMissions.find((item) => item.id === team.flashMissionId) : undefined;
              const percent = stations.length ? Math.round((done / stations.length) * 100) : 0;
              return (
                <article key={team.id} className="mgr-card">
                  <div className="mgr-card-head">
                    <h3>{team.name}</h3>
                    <b>{done}/{stations.length}</b>
                  </div>
                  <div className="mgr-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={`Postup týmu ${team.name}`}>
                    <i style={{ width: `${percent}%` }} />
                  </div>
                  <p className="mgr-where">
                    <MapPin size={14} aria-hidden="true" />
                    {next ? <>Míří na: <b>{next.title}</b>{scanned ? " · QR naskenován" : ""}</> : stations.length ? "Trasu dokončil" : "Žádná stanoviště"}
                  </p>
                  <div className="mgr-tags">
                    {mission && <span className="is-flash"><Zap size={12} aria-hidden="true" /> Přepad: {mission.title}</span>}
                    {pending > 0 && <span className="is-wait"><Clock size={12} aria-hidden="true" /> Čeká na schválení: {pending}</span>}
                    {!mission && pending === 0 && <span>V pořádku</span>}
                  </div>
                </article>
              );
            })}
          </section>
        )}

        {tab === "alert" && (
          <section className="mgr-panel" aria-label="Nouzová zpráva">
            <h2>Nouzová zpráva</h2>
            <p>Zobrazí se všem týmům na celé obrazovce. Použij jen při opravdové potřebě.</p>
            {gameState.emergencyMessage && (
              <div className="mgr-active">
                <b>Právě aktivní</b>
                <p>{gameState.emergencyMessage.message}</p>
                <button type="button" disabled={emergencyBusy || closed} onClick={() => onEmergency({ action: "clear-emergency-message" })}>
                  Zrušit zprávu
                </button>
              </div>
            )}
            <label htmlFor="mgr-emergency">Text zprávy</label>
            <textarea
              id="mgr-emergency"
              rows={5}
              maxLength={500}
              value={emergencyDraft}
              onChange={(event) => setEmergencyDraft(event.target.value)}
              placeholder="Například: Sraz všech týmů u hlavní brány do 15 minut."
            />
            <div className="mgr-count">{emergencyDraft.length}/500</div>
            {error && <p role="alert" className="mgr-error">{error}</p>}
            <button
              type="button"
              className="mgr-primary is-danger"
              disabled={closed || emergencyBusy || !emergencyDraft.trim()}
              onClick={() => onEmergency({ action: "emergency-message", message: emergencyDraft })}
            >
              <AlertTriangle size={18} aria-hidden="true" /> Odeslat všem týmům
            </button>
          </section>
        )}

        {tab === "flash" && (
          <section className="mgr-list" aria-label="Přepady">
            <button type="button" className="mgr-primary" disabled={gameState.teams.length === 0 || closed} onClick={() => { clearError(); setFlashOpen(true); }}>
              <Plus size={18} aria-hidden="true" /> Nový přepad
            </button>
            {activeMissions.length === 0 && <p className="mgr-empty">Žádný přepad právě neběží.</p>}
            {activeMissions.map((mission) => (
              <article key={mission.id} className="mgr-card">
                <div className="mgr-card-head">
                  <h3>{mission.title}</h3>
                  <span className="mgr-pill">{mission.requiresApproval ? "Ke schválení" : "Automaticky"}</span>
                </div>
                <p className="mgr-desc">{mission.description}</p>
                <p className="mgr-where">
                  <Users size={14} aria-hidden="true" />
                  {mission.targetTeamIds.map((id) => gameState.teams.find((team) => team.id === id)?.name).filter(Boolean).join(", ") || "—"}
                </p>
              </article>
            ))}
          </section>
        )}

        {tab === "support" && <div className="mgr-support"><SupportChat role="admin" /></div>}
      </main>

      <nav className="mgr-tabs" aria-label="Sekce správce">
        {tabs.map((item) => (
          <button key={item.id} type="button" aria-current={tab === item.id ? "page" : undefined} onClick={() => { clearError(); setTab(item.id); }}>
            {item.icon}
            <span>{item.label}</span>
            {item.id === "alert" && gameState.emergencyMessage && <i aria-hidden="true" />}
            {item.id === "flash" && activeMissions.length > 0 && <em>{activeMissions.length}</em>}
          </button>
        ))}
      </nav>

      {flashOpen && (
        <div className="mgr-sheet-backdrop" onClick={() => setFlashOpen(false)}>
          <form
            className="mgr-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Nový přepad"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              if (onLaunchFlash()) setFlashOpen(false);
            }}
          >
            <div className="mgr-sheet-grip" aria-hidden="true" />
            <h2>Nový přepad</h2>
            <label>
              Název
              <input value={flashForm.title} maxLength={100} onChange={(event) => setFlashForm((current) => ({ ...current, title: event.target.value }))} placeholder="Například: Tajná zpráva" />
            </label>
            <label>
              Zadání
              <textarea rows={4} maxLength={2000} value={flashForm.description} onChange={(event) => setFlashForm((current) => ({ ...current, description: event.target.value }))} placeholder="Co mají týmy udělat a co odevzdat?" />
            </label>
            <div className="mgr-seg" role="group" aria-label="Způsob odevzdání">
              {(["text", "photo"] as const).map((type) => (
                <button key={type} type="button" aria-pressed={flashForm.type === type} onClick={() => setFlashForm((current) => ({ ...current, type }))}>
                  {type === "text" ? "Text" : "Fotka"}
                </button>
              ))}
            </div>
            <div className="mgr-seg" role="group" aria-label="Komu">
              {([["all", "Všem týmům"], ["specific", "Vybraným"]] as const).map(([value, label]) => (
                <button key={value} type="button" aria-pressed={flashForm.targets === value} onClick={() => setFlashForm((current) => ({ ...current, targets: value }))}>
                  {label}
                </button>
              ))}
            </div>
            {flashForm.targets === "specific" && (
              <div className="mgr-chips" role="group" aria-label="Vyber týmy">
                {gameState.teams.map((team) => {
                  const on = flashForm.targetTeamIds.includes(team.id);
                  return (
                    <button
                      key={team.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setFlashForm((current) => ({
                        ...current,
                        targetTeamIds: on ? current.targetTeamIds.filter((id) => id !== team.id) : [...current.targetTeamIds, team.id],
                      }))}
                    >
                      {on && <Check size={14} aria-hidden="true" />} {team.name}
                    </button>
                  );
                })}
              </div>
            )}
            <label className="mgr-check">
              <input type="checkbox" checked={flashForm.requiresApproval} onChange={(event) => setFlashForm((current) => ({ ...current, requiresApproval: event.target.checked }))} />
              <span>Odpověď musí schválit pořadatel</span>
            </label>
            {error && <p role="alert" className="mgr-error">{error}</p>}
            <div className="mgr-sheet-actions">
              <button type="button" onClick={() => setFlashOpen(false)}>Zavřít</button>
              <button type="submit" className="mgr-primary"><Zap size={17} aria-hidden="true" /> Odeslat</button>
            </div>
          </form>
        </div>
      )}

      {wallOpen && (
        <div className="mgr-sheet-backdrop" onClick={() => setWallOpen(false)}>
          <div className="mgr-sheet" role="dialog" aria-modal="true" aria-label="Tapeta" onClick={(event) => event.stopPropagation()}>
            <div className="mgr-sheet-grip" aria-hidden="true" />
            <h2>Tapeta</h2>
            <div className="mgr-walls">
              {WALLPAPERS.map((item) => (
                <button key={item.id} type="button" data-wall-pick={item.id} aria-pressed={wallpaper === item.id} onClick={() => { setWallpaper(item.id); setWallOpen(false); }}>
                  <i data-swatch={item.id} aria-hidden="true" />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Příkazová paleta: filtrovatelný seznam akcí ovládaný klávesnicí.
function CommandPalette({ items, onClose }: { items: { id: string; label: string; hint: string; run: () => void }[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const filtered = items.filter((item) => normalize(`${item.label} ${item.hint}`).includes(normalize(query)));
  const run = (item?: (typeof items)[number]) => {
    if (!item) return;
    onClose();
    item.run();
  };
  return (
    <div className="os-palette-backdrop" onMouseDown={onClose}>
      <div className="os-palette" role="dialog" aria-label="Příkazová paleta" onMouseDown={(event) => event.stopPropagation()}>
        <input
          ref={inputRef}
          value={query}
          placeholder="Přejít na modul nebo spustit příkaz…"
          onChange={(event) => { setQuery(event.target.value); setCursor(0); }}
          onKeyDown={(event) => {
            if (event.key === "Escape") onClose();
            else if (event.key === "ArrowDown") { event.preventDefault(); setCursor((value) => Math.min(value + 1, filtered.length - 1)); }
            else if (event.key === "ArrowUp") { event.preventDefault(); setCursor((value) => Math.max(value - 1, 0)); }
            else if (event.key === "Enter") run(filtered[cursor]);
          }}
        />
        <ul>
          {filtered.length === 0 && <li className="os-palette-empty">Nic nenalezeno</li>}
          {filtered.map((item, index) => (
            <li key={item.id}>
              <button type="button" className={index === cursor ? "is-active" : ""} onMouseEnter={() => setCursor(index)} onClick={() => run(item)}>
                <span>{item.label}</span><small>{item.hint}</small>
              </button>
            </li>
          ))}
        </ul>
        <footer><span>↑↓ vybrat</span><span>↵ otevřít</span><span>esc zavřít</span></footer>
      </div>
    </div>
  );
}

// Systémové hodiny v horní liště; do prvního ticku nic nevykreslí.
function WallClock({ className = "" }: { className?: string }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const timer = window.setInterval(tick, 10_000);
    return () => window.clearInterval(timer);
  }, []);
  if (!now) return <span className={className} />;
  return (
    <span className={className}>
      {now.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}
    </span>
  );
}

// Přepíná celou obrazovku, aby admin vypadal jako samostatný systém.
function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.().catch(() => undefined);
}

// Převede uložené odpovědi formuláře na čitelný text pro administraci.
function formatEvidence(station: Station | undefined, evidence: string) {
  if (station?.type !== "form") return evidence;
  try {
    const answers = JSON.parse(evidence) as Record<string, unknown>;
    return (station.formQuestions ?? [])
      .map((question, index) => `${index + 1}. ${question.label}: ${String(answers[question.id] ?? "—")}`)
      .join("\n");
  } catch {
    return evidence;
  }
}

// Porovná odevzdanou odpověď se správnou a zobrazí výsledek kontrole.
function SubmissionAnswerReview({ station, evidence }: { station?: Station; evidence: string }) {
  // Pro srovnání ignoruje velikost písmen a diakritiku, nemění uloženou odpověď.
  const normalize = (value: string) =>
    value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();

  if (station?.type === "form") {
    let answers: Record<string, unknown> = {};
    try {
      answers = JSON.parse(evidence) as Record<string, unknown>;
    } catch {}
    return (
      <div className="mt-2 divide-y divide-[#eadfc9] overflow-hidden rounded-xl border border-[#e7d7b4] bg-white text-sm">
        {(station.formQuestions ?? []).map((question, index) => {
          const given = String(answers[question.id] ?? "—");
          const matches = question.answer ? normalize(given) === normalize(question.answer) : undefined;
          return (
            <div key={question.id} className="p-3">
              <p className="text-xs font-semibold text-[#6f5a49]">{index + 1}. {question.label}</p>
              <p className="mt-1 font-semibold text-[#2b2523]">
                {matches !== undefined && (
                  <span className={matches ? "mr-1.5 text-[#1e7a43]" : "mr-1.5 text-[#b0342a]"}>{matches ? "✓" : "✗"}</span>
                )}
                Tým: {given}
              </p>
              {question.answer && <p className="text-xs text-[#1e5131]">Správně: {question.answer}</p>}
            </div>
          );
        })}
      </div>
    );
  }

  const matches = station?.answer ? normalize(evidence) === normalize(station.answer) : undefined;
  return (
    <div className="mt-2 rounded-xl border border-[#e7d7b4] bg-white p-3 text-sm">
      <p className="whitespace-pre-wrap font-semibold text-[#2b2523]">
        {matches !== undefined && (
          <span className={matches ? "mr-1.5 text-[#1e7a43]" : "mr-1.5 text-[#b0342a]"}>{matches ? "✓" : "✗"}</span>
        )}
        Odpověď týmu: {evidence}
      </p>
      {station?.answer && <p className="mt-1 text-xs text-[#1e5131]">Správná odpověď: {station.answer}</p>}
    </div>
  );
}

// Vygeneruje osmiznakové UID, které nekoliduje s existujícími stanovišti.
function createUniqueStationUid(stations: Station[]) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const existingUids = new Set(stations.map((station) => station.uid.toUpperCase()));
  let uid = "";

  // Zkouší nové náhodné kódy, dokud nenajde dosud nepoužité UID.
  do {
    const randomValues = crypto.getRandomValues(new Uint8Array(8));
    uid = Array.from(randomValues, (value) => alphabet[value % alphabet.length]).join("");
  } while (existingUids.has(uid));

  return uid;
}

// Najde QR SVG v DOM a stáhne jeho samostatnou kopii jako soubor.
function downloadQrSvg(value: string, fileName: string) {
  const qrCode = Array.from(document.querySelectorAll<SVGSVGElement>("[data-qr-uid]")).find(
    (element) => element.dataset.qrUid === value,
  );
  if (!qrCode) return false;

  const downloadableQr = qrCode.cloneNode(true) as SVGSVGElement;
  downloadableQr.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const file = new Blob([new XMLSerializer().serializeToString(downloadableQr)], {
    type: "image/svg+xml;charset=utf-8",
  });
  const fileUrl = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = fileUrl;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(fileUrl), 1000);
  return true;
}

// Načte QR kartičky ze serveru (pokud ještě není známa) a nabídne její stažení.
function TeamCardQr({ cardId, fileName, size, label, centered = false }: { cardId: string; fileName: string; size: number; label: string; centered?: boolean }) {
  const [value, setValue] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/team-qr-cards?id=${encodeURIComponent(cardId)}`, { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as { token?: string };
        if (!response.ok || !result.token) throw new Error();
        if (!cancelled) setValue(createTeamLoginUrl(result.token));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [cardId]);

  if (!value) {
    return (
      <div
        className="flex items-center justify-center rounded-lg bg-[#f5efe8] p-2 text-center text-xs font-semibold text-[#675d53]"
        style={{ width: size, height: size }}
      >
        {failed ? "QR nelze zobrazit" : "Načítám…"}
      </div>
    );
  }
  return (
    <div className={`flex flex-col gap-2 ${centered ? "items-center" : "items-start"}`}>
      <QRCodeSVG value={value} size={size} level="Q" marginSize={3} title={label} data-qr-uid={value} />
      <button
        type="button"
        onClick={() => downloadQrSvg(value, fileName)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-[#312d27] px-3 py-2 text-xs font-bold text-white"
      >
        <Download size={14} /> Stáhnout QR
      </button>
    </div>
  );
}

// Vytvoří herní událost s ID a časem pro živý přehled.
function createEvent(message: string, tone: GameEvent["tone"] = "info", teamId?: string): GameEvent {
  return {
    id: crypto.randomUUID(),
    teamId,
    message,
    tone,
    createdAt: new Date().toISOString(),
  };
}

// Připraví bezpečný klientský stav i při chybějících polích starých záznamů.
function normalizeGameState(value?: Partial<GameState> | null): GameState {
  const safeValue = value && typeof value === "object" ? value : {};

  return {
    stations: Array.isArray(safeValue.stations)
      ? safeValue.stations.map((station) => ({
          ...station,
          clue: station.clue || "",
        }))
      : [],
    teams: Array.isArray(safeValue.teams)
      ? safeValue.teams.map((team) => ({
          ...team,
          scannedStationIds: Array.isArray(team.scannedStationIds) ? team.scannedStationIds : [],
          progressVersion: Number.isInteger(team.progressVersion) && (team.progressVersion ?? 0) >= 0
            ? team.progressVersion
            : 0,
          flashMissionsUsed: Number.isInteger(team.flashMissionsUsed) && (team.flashMissionsUsed ?? 0) >= 0
            ? team.flashMissionsUsed
            : 0,
        }))
      : [],
    submissions: Array.isArray(safeValue.submissions) ? safeValue.submissions : [],
    flashMissions: Array.isArray(safeValue.flashMissions) ? safeValue.flashMissions : [],
    events: Array.isArray(safeValue.events) ? safeValue.events : [],
    gameStartedAt: typeof safeValue.gameStartedAt === "string" ? safeValue.gameStartedAt : undefined,
    gameStoppedAt: typeof safeValue.gameStoppedAt === "string" ? safeValue.gameStoppedAt : undefined,
    gamePausedMs: typeof safeValue.gamePausedMs === "number" && safeValue.gamePausedMs > 0 ? safeValue.gamePausedMs : 0,
    emergencyMessage: safeValue.emergencyMessage &&
      typeof safeValue.emergencyMessage.message === "string" &&
      typeof safeValue.emergencyMessage.createdAt === "string"
      ? safeValue.emergencyMessage
      : undefined,
    gameClosedAt: typeof safeValue.gameClosedAt === "string" ? safeValue.gameClosedAt : undefined,
    gameResults: Array.isArray(safeValue.gameResults) ? safeValue.gameResults : undefined,
    ambushTargets: Array.isArray(safeValue.ambushTargets) ? safeValue.ambushTargets : undefined,
  };
}

// Hlavní klientská stránka řídí přihlášení, obrazovku týmu i administraci.
export default function Page() {
  const [gameState, setGameState] = useState<GameState>(emptyGameState);
  const [isLoadingGameState, setIsLoadingGameState] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginStatus, setLoginStatus] = useState("Přihlašuji tým…");
  const [isSavingGameState, setIsSavingGameState] = useState(false);
  const [saveError, setSaveError] = useState("");
  const lastPersistedStateRef = useRef<string | null>(null);
  const latestGameStateRef = useRef(gameState);
  const [saveRevision, setSaveRevision] = useState(0);
  const [screen, setScreen] = useState<Screen>("team-login");
  const [authVisualMode, setAuthVisualMode] = useState<AuthVisualMode>("sunset");
  const [showTeamPassword, setShowTeamPassword] = useState(false);
  const [showAdminPassword, setShowAdminPassword] = useState(false);
  const [teamQrScannerOpen, setTeamQrScannerOpen] = useState(false);
  const [teamQrScanMessage, setTeamQrScanMessage] = useState("Umístěte přihlašovací QR kód do rámečku.");
  const loginInProgressRef = useRef(false);
  const automaticQrLoginAttemptedRef = useRef(false);
  const [teamForm, setTeamForm] = useState({ name: "", password: "" });
  const [adminForm, setAdminForm] = useState({ email: "", password: "" });
  const teamNameInputRef = useRef<HTMLInputElement | null>(null);
  const teamPasswordInputRef = useRef<HTMLInputElement | null>(null);
  const adminUsernameInputRef = useRef<HTMLInputElement | null>(null);
  const adminPasswordInputRef = useRef<HTMLInputElement | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [deletingTeamId, setDeletingTeamId] = useState<string | null>(null);
  const [gameControlBusy, setGameControlBusy] = useState(false);
  const [generatedTeamQr, setGeneratedTeamQr] = useState<{ teamId: string; value: string } | null>(null);
  const [galleryPage, setGalleryPage] = useState(0);
  const [teamPage, setTeamPage] = useState(0);
  const [stationPage, setStationPage] = useState(0);
  const [isTeamDialogOpen, setIsTeamDialogOpen] = useState(false);
  const [isCreatingTeam, setIsCreatingTeam] = useState(false);
  const [createdTeamQr, setCreatedTeamQr] = useState<{ teamId: string; name: string; value: string } | null>(null);
  const [teamQrCards, setTeamQrCards] = useState<TeamQrCard[]>([]);
  const [isCreatingTeamQrCard, setIsCreatingTeamQrCard] = useState(false);
  const [isStationDialogOpen, setIsStationDialogOpen] = useState(false);
  const [editingStationId, setEditingStationId] = useState<string | null>(null);
  const [isFlashDialogOpen, setIsFlashDialogOpen] = useState(false);
  const [stationFormStep, setStationFormStep] = useState<0 | 1>(0);
  const [presentationIndex, setPresentationIndex] = useState<number | null>(null);
  const [flashDraft, setFlashDraft] = useState("");
  const [flashMediaFile, setFlashMediaFile] = useState<File | null>(null);
  const [flashMediaPreview, setFlashMediaPreview] = useState("");
  const [isSubmittingFlash, setIsSubmittingFlash] = useState(false);
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const cameraPermissionRequestedRef = useRef(false);
  const [manualUidOpen, setManualUidOpen] = useState(false);
  const [manualUidDraft, setManualUidDraft] = useState("");
  const [scanMessage, setScanMessage] = useState("Naskenujte QR kód, nebo zadejte UID ručně.");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [mediaFiles, setMediaFiles] = useState<Record<string, File>>({});
  const [mediaPreviews, setMediaPreviews] = useState<Record<string, string>>({});
  const [submittingStationId, setSubmittingStationId] = useState<string | null>(null);
  const [stationResultAnimation, setStationResultAnimation] = useState<{
    teamId: string;
    result: "completed" | "rejected";
    key: string;
  } | null>(null);
  const previousSubmissionStatusesRef = useRef(new Map<string, SubmissionStatus>());
  const previousTeamProgressRef = useRef<{
    teamId: string;
    completedStationIds: Set<string>;
  } | null>(null);
  const mediaPreviewUrlsRef = useRef<string[]>([]);
  const [formDrafts, setFormDrafts] = useState<Record<string, Record<string, string>>>({});
  const [adminStationForm, setAdminStationForm] = useState({
    title: "",
    description: "",
    clue: "",
    task: "",
    uid: "",
    type: "text" as StationType,
    instructions: "",
    requiresApproval: true,
    answer: "",
    optionsText: "",
    formQuestions: [] as NonNullable<Station["formQuestions"]>,
    questionDraft: {
      label: "",
      type: "text" as "text" | "number" | "multiple-choice",
      optionsText: "",
      answer: "",
    },
  });
  const [visibleStationQr, setVisibleStationQr] = useState<string | null>(null);
  const [teamFormAdmin, setTeamFormAdmin] = useState({
    name: "",
    password: "",
    qrCardId: "",
  });
  const [flashMissionForm, setFlashMissionForm] = useState({
    title: "",
    description: "",
    type: "text" as StationType,
    targets: "all",
    targetTeamIds: [] as string[],
    requiresApproval: true,
  });
  const [teamAmbushForm, setTeamAmbushForm] = useState({
    targetTeamId: "",
    title: "",
    description: "",
    type: "photo" as "photo" | "video",
  });
  const [teamAmbushBusy, setTeamAmbushBusy] = useState(false);
  const [adminTab, setAdminTabState] = useState<AdminTab>("teams");
  const [openTabs, setOpenTabs] = useState<AdminTab[]>([]);
  const [minTabs, setMinTabs] = useState<AdminTab[]>([]);
  const isDesktop = useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia("(min-width: 900px)").matches,
    () => false,
  );
  // Zaostří okno modulu: otevře ho, vynese nahoru a vrátí z minimalizace.
  const setAdminTab = useCallback((tab: AdminTab) => {
    setAdminTabState(tab);
    setOpenTabs((tabs) => [...tabs.filter((item) => item !== tab), tab]);
    setMinTabs((tabs) => tabs.filter((item) => item !== tab));
  }, []);
  const closeTab = (tab: AdminTab) => {
    const remaining = openTabs.filter((item) => item !== tab);
    setOpenTabs(remaining);
    setMinTabs((tabs) => tabs.filter((item) => item !== tab));
    if (adminTab === tab) {
      const next = [...remaining].reverse().find((item) => !minTabs.includes(item));
      if (next) setAdminTabState(next);
    }
  };
  const minimizeTab = (tab: AdminTab) => {
    setMinTabs((tabs) => (tabs.includes(tab) ? tabs : [...tabs, tab]));
    if (adminTab === tab) {
      const next = [...openTabs].reverse().find((item) => item !== tab && !minTabs.includes(item));
      if (next) setAdminTabState(next);
    }
  };
  const isTabOpen = (tab: AdminTab) => (isDesktop ? openTabs.includes(tab) : adminTab === tab);
  const winProps = (tab: AdminTab) => ({
    id: tab,
    title: ADMIN_TAB_TITLES[tab],
    z: openTabs.indexOf(tab) + 10,
    active: adminTab === tab,
    slot: Math.max(0, openTabs.indexOf(tab)),
    minimized: minTabs.includes(tab),
    onFocus: () => { if (adminTab !== tab) setAdminTab(tab); },
    onClose: () => closeTab(tab),
    onMinimize: () => minimizeTab(tab),
  });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const wallpaper = useSyncExternalStore(subscribeWallpaper, readWallpaper, () => "parchment" as Wallpaper);
  const [deskMenu, setDeskMenu] = useState<{ x: number; y: number } | null>(null);
  const setWallpaper = (next: Wallpaper) => {
    window.localStorage.setItem("podzimky-wallpaper", next);
    window.dispatchEvent(new Event("podzimky-wallpaper"));
  };
  useEffect(() => {
    // Ctrl/⌘+K otevře příkazovou paletu jako Spotlight.
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const [isOwnerAdmin, setIsOwnerAdmin] = useState(false);
  const [ownerActionBusy, setOwnerActionBusy] = useState(false);
  const [emergencyDraft, setEmergencyDraft] = useState("");
  const [manualTeamId, setManualTeamId] = useState("");
  const [manualStationId, setManualStationId] = useState("");
  const [managers, setManagers] = useState<Array<{ id: string; username: string; createdAt: string }>>([]);
  const [managerForm, setManagerForm] = useState({ username: "", password: "" });
  const [managerBusy, setManagerBusy] = useState(false);
  const [managerError, setManagerError] = useState("");

  const loadTeamQrCards = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/team-qr-cards", { cache: "no-store" });
      const result = await response.json() as { cards?: TeamQrCard[]; error?: string };
      if (!response.ok || !result.cards) {
        throw new Error(result.error ?? "QR kartičky se nepodařilo načíst.");
      }
      const loadedCards = result.cards;
      setTeamQrCards((currentCards) => {
        const loadedById = new Map(loadedCards.map((card) => [card.id, card]));
        return [
          ...currentCards.map((card) => loadedById.get(card.id) ?? card),
          ...loadedCards.filter((card) => !currentCards.some((current) => current.id === card.id)),
        ];
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "QR kartičky se nepodařilo načíst.");
    }
  }, []);

  useEffect(() => () => {
    // Uvolní adresy lokálních náhledů médií, aby nezůstávaly v paměti.
    mediaPreviewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    // Načte serverovou relaci po refreshi a obnoví obrazovku podle uživatelské role.
    let isMounted = true;

    fetch("/api/auth/session")
      .then((response) => {
        if (response.status === 401) return null;
        if (!response.ok) {
          throw new Error("Unable to load game state");
        }
        return response.json() as Promise<{ user: { role: "admin"; managerId?: string } | { role: "team"; teamId: string }; state: GameState }>;
      })
      .then((session) => {
        if (isMounted) {
          if (session) {
            const state = normalizeGameState(session.state);
            lastPersistedStateRef.current = JSON.stringify(state);
            setGameState(state);
            const sessionUser = session.user;
            if (sessionUser.role === "admin") {
              setIsOwnerAdmin(!sessionUser.managerId);
              setAdminTabState("teams");
      setOpenTabs([]);
      setMinTabs([]);
              setScreen("admin-panel");
              void loadTeamQrCards();
            } else {
              const restoredTeamId = sessionUser.teamId;
              setTeamId(restoredTeamId);
              setScreen("team-dashboard");
              setSelectedStationId(
                state.stations.find((station) => station.order === getNextOrder(
                  state.teams.find((team) => team.id === restoredTeamId),
                  state.stations,
                ))?.id ?? null,
              );
            }
            setIsAuthenticated(true);
          }
          setIsLoadingGameState(false);
        }
      })
      .catch(() => {
        if (isMounted) {
          setError("Nepodařilo se spojit se serverem. Obnovte stránku a zkuste to znovu.");
          setIsLoadingGameState(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [loadTeamQrCards]);

  useEffect(() => {
    if (
      !isAuthenticated ||
      screen !== "team-dashboard" ||
      !teamId ||
      cameraPermissionRequestedRef.current
    ) {
      return;
    }

    // Jednou ověří oprávnění ke kameře a stream hned zastaví, dokud nezačne sken.
    cameraPermissionRequestedRef.current = true;
    let isMounted = true;
    const permissionRequest = navigator.mediaDevices?.getUserMedia
      ? navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { exact: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        })
      : Promise.reject(new Error("Camera API unavailable"));

    void permissionRequest
      .then((stream) => {
        stream.getTracks().forEach((track) => track.stop());
        if (!isMounted) return;
        setScanMessage("Zadní kamera je povolena. Namiřte ji na QR kód stanoviště.");
      })
      .catch((cameraError: unknown) => {
        if (isMounted) {
          const errorName = cameraError instanceof Error ? cameraError.name : "";
          setScanMessage(
            errorName === "NotFoundError" || errorName === "OverconstrainedError"
              ? "Nepodařilo se najít zadní kameru tohoto zařízení."
              : errorName === "NotAllowedError" || errorName === "PermissionDeniedError"
                ? "Povolte přístup ke kameře v nastavení webu a zkuste skenování znovu."
                : "Kamera není dostupná. Otevřete hru přes zabezpečené HTTPS připojení.",
          );
        }
      });

    return () => {
      isMounted = false;
    };
  }, [isAuthenticated, screen, teamId]);

  useEffect(() => {
    if (isLoadingGameState || !isAuthenticated) {
      return;
    }

    const serializedState = JSON.stringify(gameState);
    if (serializedState === lastPersistedStateRef.current) return;

    // Krátké zpoždění sloučí rychlé změny a omezí zbytečné zápisy.
    const timer = window.setTimeout(() => {
      setIsSavingGameState(true);
      fetch("/api/game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: serializedState,
      })
        .then(async (response) => {
          const result = await response.json() as { state?: GameState; error?: unknown };
          if (!response.ok || !result.state) {
            throw new Error(typeof result.error === "string" ? result.error : "Změny se nepodařilo uložit.");
          }
          const savedState = normalizeGameState(result.state);
          setGameState((current) => {
            if (JSON.stringify(current) === serializedState) {
              lastPersistedStateRef.current = JSON.stringify(savedState);
              return savedState;
            }
            lastPersistedStateRef.current = serializedState;
            return current;
          });
          setSaveError("");
        })
        .catch((saveError: unknown) => {
          setSaveError(saveError instanceof Error ? saveError.message : "Změny se nepodařilo uložit.");
        })
        .finally(() => setIsSavingGameState(false));
    }, 300);

    return () => window.clearTimeout(timer);
  }, [gameState, isAuthenticated, isLoadingGameState, saveRevision]);

  useEffect(() => {
    latestGameStateRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    if (!isAuthenticated) return;

    // Průběžné načítání sdílí změny s ostatními zařízeními; skryté karty nebudí síť.
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      fetch("/api/game")
        .then(async (response) => {
          if (!response.ok) throw new Error("Aktuální stav hry se nepodařilo načíst.");
          return normalizeGameState(await response.json() as GameState);
        })
        .then((serverState) => {
          const serverSignature = JSON.stringify(serverState);
          setGameState((current) => {
            if (JSON.stringify(current) !== lastPersistedStateRef.current) return current;
            lastPersistedStateRef.current = serverSignature;
            return serverState;
          });
        })
        .catch((refreshError: unknown) => {
          setSaveError(refreshError instanceof Error ? refreshError.message : "Spojení se serverem bylo přerušeno.");
        });
    }, 5000);

    return () => window.clearInterval(interval);
  }, [isAuthenticated]);

  const activeTeam = useMemo(
    () => gameState.teams.find((team) => team.id === teamId) ?? null,
    [gameState.teams, teamId],
  );
  const nextOrder = getNextOrder(activeTeam, gameState.stations);

  // Ověří naskenované UID na serveru a promítne otevřené stanoviště do UI.
  const handleScanResult = useCallback(async (uid: string) => {
    if (!activeTeam) return;

    const normalizedUid = uid.trim().toUpperCase();
    if (!isValidUid(normalizedUid)) {
      setScanMessage("QR kód se nedaří načíst?");
      setError("UID musí mít přesně 8 znaků. Zadejte platný kód.");
      return;
    }

    try {
      const response = await fetch("/api/team/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid: normalizedUid }),
      });
      const result = await response.json() as { team?: Team; station?: Station; events?: GameEvent[]; error?: string };
      if (!response.ok || !result.team || !result.station) {
        throw new Error(result.error ?? "QR kód se nepodařilo ověřit.");
      }
      setGameState((previous) => ({
        ...previous,
        teams: previous.teams.map((team) =>
          team.id === result.team?.id ? result.team : team,
        ),
        stations: result.station
          ? previous.stations.map((item) => item.id === result.station?.id ? result.station : item)
          : previous.stations,
        events: result.events ?? previous.events,
      }));
      setSelectedStationId(result.station.id);
      setScanMessage(
        result.team.completedStations.includes(result.station.id)
          ? "Toto stanoviště už jste splnili."
          : "Stanoviště otevřeno.",
      );
      setError("");
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "QR kód se nepodařilo ověřit.");
      setScannerOpen(false);
      return;
    }
    setScannerOpen(false);
  }, [activeTeam]);

  useEffect(() => {
    if (!scannerOpen) return;

    // Spustí kameru pro sken stanoviště a zastaví ji při zavření skeneru.
    let scanner: Html5QrcodeInstance | undefined;
    let isDisposed = false;
    let startSettled = false;
    let hasScanned = false;

    // Uvolní HTML5 QR skener po jeho zastavení.
    const clearScanner = () => scanner?.clear();
    // Inicializuje kameru, zpracuje jeden výsledek a zobrazí chyby zařízení.
    const startScanner = async () => {
      try {
        scanner = await createQrScanner("qr-reader-element");
        if (isDisposed) return;
        await scanner.start(
          { facingMode: { exact: "environment" } },
          {
            fps: 12,
            qrbox: (viewfinderWidth, viewfinderHeight) => {
              const size = Math.floor(Math.min(viewfinderWidth * 0.82, viewfinderHeight * 0.72, 360));
              return { width: size, height: size };
            },
            videoConstraints: {
              facingMode: { exact: "environment" },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          },
          (decodedText) => {
            if (isDisposed || hasScanned) return;
            hasScanned = true;
            setScanMessage("QR kód načten, ověřuji stanoviště…");
            setScannerOpen(false);
            void handleScanResult(decodedText);
          },
          () => undefined,
        );
        startSettled = true;
        if (isDisposed && scanner.isScanning) await scanner.stop();
        if (isDisposed) clearScanner();
      } catch (scanError: unknown) {
        startSettled = true;
        if (!isDisposed) {
          const errorName = scanError instanceof Error ? scanError.name : "";
          setScanMessage(
            errorName === "NotAllowedError" || errorName === "PermissionDeniedError"
              ? "Přístup ke kameře je zablokovaný. Povolte kameru v nastavení webu a zkuste to znovu."
              : errorName === "NotFoundError" || errorName === "DevicesNotFoundError"
                ? "Nepodařilo se najít zadní kameru tohoto zařízení."
                : "Kameru se nepodařilo spustit. Zkontrolujte oprávnění a zkuste to znovu.",
          );
        } else {
          clearScanner();
        }
      }
    };
    void startScanner();

    return () => {
      isDisposed = true;
      if (scanner?.isScanning) {
        void scanner.stop().then(clearScanner).catch((stopError: unknown) => {
          console.error("QR scanner could not be stopped cleanly.", stopError);
        });
      } else if (startSettled) {
        clearScanner();
      }
    };
  }, [scannerOpen, handleScanResult]);

  // Vymění Firebase token za serverovou cookie a nastaví obrazovku týmu.
  const completeTeamLogin = useCallback(async (customToken: string) => {
    const [{ inMemoryPersistence, setPersistence, signInWithCustomToken }, auth] = await Promise.all([
      import("firebase/auth"),
      getFirebaseAuth(),
    ]);
    await setPersistence(auth, inMemoryPersistence);
    const credential = await signInWithCustomToken(auth, customToken);
    // Firebase token se mění za serverovou cookie; citlivá relace nezůstává v localStorage.
    const response = await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: await credential.user.getIdToken() }),
    });
    const result = await response.json() as {
      user?: { role: "team"; teamId: string } | { role: "admin"; managerId?: string };
      state?: GameState;
      error?: string;
    };
    if (!response.ok || !result.user || !result.state) {
      throw new Error(result.error ?? "Přihlášení týmu se nezdařilo.");
    }
    const state = normalizeGameState(result.state);
    lastPersistedStateRef.current = JSON.stringify(state);
    if (result.user.role === "admin") {
      setGameState(state);
      setIsOwnerAdmin(false);
      setAdminTabState("teams");
      setOpenTabs([]);
      setMinTabs([]);
      setIsAuthenticated(true);
      setError("");
      setScreen("admin-panel");
      void loadTeamQrCards();
      return;
    }
    const loggedTeamId = result.user.teamId;
    const team = state.teams.find((item) => item.id === loggedTeamId);
    if (!team) throw new Error("Přihlášený tým nebyl nalezen.");
    setGameState(state);
    setTeamId(team.id);
    setTeamForm({ name: team.name, password: "" });
    setIsAuthenticated(true);
    setError("");
    setScreen("team-dashboard");
    setSelectedStationId(
      state.stations.find((station) => station.order === getNextOrder(team, state.stations))?.id ?? null,
    );
  }, [loadTeamQrCards]);

  // Ověří přihlašovací údaje týmu a zahájí vytvoření serverové relace.
  const handleTeamLogin = async () => {
    if (loginInProgressRef.current) return;
    loginInProgressRef.current = true;
    setIsLoggingIn(true);
    setLoginStatus("Přihlašuji tým…");
    setError("");
    const enteredName = teamNameInputRef.current?.value ?? teamForm.name;
    const enteredPassword = teamPasswordInputRef.current?.value ?? teamForm.password;
    try {
      const loginResponse = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "team", name: enteredName, password: enteredPassword }),
      });
      const loginResult = await loginResponse.json() as {
        customToken?: string;
        error?: string;
      };
      if (!loginResponse.ok || !loginResult.customToken) {
        throw new Error(loginResult.error ?? "Nesprávné přihlašovací údaje týmu.");
      }
      await completeTeamLogin(loginResult.customToken);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Přihlášení týmu se nezdařilo.");
    } finally {
      loginInProgressRef.current = false;
      setIsLoggingIn(false);
    }
  };

  // Ověří přihlašovací QR týmu (odkaz i starší kód) a převede token na relaci.
  const handleTeamQrLogin = useCallback(async (decodedText: string) => {
    if (loginInProgressRef.current) return;
    const prefix = "podzimky-team-login:";
    const decodedValue = decodedText.trim();
    let token = "";
    if (decodedValue.startsWith(prefix)) {
      token = decodedValue.slice(prefix.length);
    } else if (/^[A-Za-z0-9_-]{43}$/.test(decodedValue)) {
      token = decodedValue;
    } else {
      try {
        const url = new URL(decodedValue);
        if (url.origin === window.location.origin && url.pathname === "/") {
          token = url.searchParams.get("team-login") ?? "";
        }
      } catch {
        token = "";
      }
    }

    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      setError("Tento QR kód není přihlašovací kód týmu.");
      setTeamQrScanMessage("Tento kód není určený k přihlášení týmu.");
      return;
    }

    loginInProgressRef.current = true;
    setIsLoggingIn(true);
    setLoginStatus("Ověřuji přihlašovací QR kód…");
    try {
      setError("");
      setTeamQrScanMessage("Kód načten, ověřuji přihlášení…");
      const response = await fetch("/api/auth/qr-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const result = await response.json() as { customToken?: string; error?: string };
      if (!response.ok || !result.customToken) {
        throw new Error(result.error ?? "QR kód není platný.");
      }
      await completeTeamLogin(result.customToken);
    } catch (loginError) {
      const message = loginError instanceof Error ? loginError.message : "Přihlášení přes QR kód se nezdařilo.";
      setError(message);
      setTeamQrScanMessage(message);
    } finally {
      loginInProgressRef.current = false;
      setIsLoggingIn(false);
    }
  }, [completeTeamLogin]);

  useEffect(() => {
    if (isLoadingGameState || automaticQrLoginAttemptedRef.current) return;

    const url = new URL(window.location.href);
    if (!url.searchParams.has("team-login")) return;

    automaticQrLoginAttemptedRef.current = true;
    const token = url.searchParams.get("team-login") ?? "";
    url.searchParams.delete("team-login");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    if (!isAuthenticated) {
      window.setTimeout(() => void handleTeamQrLogin(token), 0);
    }
  }, [handleTeamQrLogin, isAuthenticated, isLoadingGameState]);

  useEffect(() => {
    if (!teamQrScannerOpen) return;

    // Spustí přihlašovací QR skener a uklidí kameru při jeho zavření.
    let scanner: Html5QrcodeInstance | undefined;
    let isDisposed = false;
    let startSettled = false;
    let hasScanned = false;

    // Uklidí vykreslený skener po zastavení kamery.
    const clearScanner = () => scanner?.clear();
    // Spustí sken přihlašovacího kódu a ignoruje duplicitní výsledky.
    const startScanner = async () => {
      try {
        scanner = await createQrScanner("team-qr-login-reader");
        if (isDisposed) return;
        await scanner.start(
          { facingMode: { exact: "environment" } },
          {
            fps: 12,
            qrbox: (viewfinderWidth, viewfinderHeight) => {
              const size = Math.floor(Math.min(viewfinderWidth * 0.82, viewfinderHeight * 0.72, 360));
              return { width: size, height: size };
            },
            videoConstraints: {
              facingMode: { exact: "environment" },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          },
          (decodedText) => {
            if (isDisposed || hasScanned) return;
            hasScanned = true;
            setTeamQrScannerOpen(false);
            void handleTeamQrLogin(decodedText);
          },
          () => undefined,
        );
        startSettled = true;
        if (isDisposed && scanner.isScanning) await scanner.stop();
        if (isDisposed) clearScanner();
      } catch (scanError: unknown) {
        startSettled = true;
        if (!isDisposed) {
          const errorName = scanError instanceof Error ? scanError.name : "";
          const message = errorName === "NotAllowedError" || errorName === "PermissionDeniedError"
            ? "Přístup ke kameře je zablokovaný. Povolte kameru v nastavení webu."
            : errorName === "NotFoundError" || errorName === "DevicesNotFoundError"
              ? "Nepodařilo se najít zadní kameru tohoto zařízení."
              : "Kameru se nepodařilo spustit. Zkontrolujte oprávnění.";
          setTeamQrScanMessage(message);
          setError(message);
        } else {
          clearScanner();
        }
      }
    };
    void startScanner();

    return () => {
      isDisposed = true;
      if (scanner?.isScanning) {
        void scanner.stop().then(clearScanner).catch((stopError: unknown) => {
          console.error("QR login scanner could not be stopped cleanly.", stopError);
        });
      } else if (startSettled) {
        clearScanner();
      }
    };
  }, [teamQrScannerOpen, handleTeamQrLogin]);

  // Přihlásí hlavního administrátora přes Firebase a načte jeho herní stav.
  const handleAdminLogin = async () => {
    if (loginInProgressRef.current) return;
    loginInProgressRef.current = true;
    setIsLoggingIn(true);
    setLoginStatus("Přihlašuji administrátora…");
    setError("");
    const enteredEmail = adminUsernameInputRef.current?.value ?? adminForm.email;
    const enteredPassword = adminPasswordInputRef.current?.value ?? adminForm.password;

    try {
      const [{ inMemoryPersistence, setPersistence, signInWithEmailAndPassword }, auth] = await Promise.all([
        import("firebase/auth"),
        getFirebaseAuth(),
      ]);
      await setPersistence(auth, inMemoryPersistence);
      const credential = await signInWithEmailAndPassword(auth, enteredEmail, enteredPassword);
      const sessionResponse = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: await credential.user.getIdToken() }),
      });
      const result = await sessionResponse.json() as { user?: { role: "admin" }; state?: GameState; error?: string };
      if (!sessionResponse.ok || !result.user || !result.state) {
        throw new Error(result.error ?? "Nesprávné admin přihlašovací údaje.");
      }
      const state = normalizeGameState(result.state);
      lastPersistedStateRef.current = JSON.stringify(state);
      setGameState(state);
      setAdminForm({ email: enteredEmail, password: "" });
      setIsOwnerAdmin(true);
      setAdminTabState("teams");
      setOpenTabs([]);
      setMinTabs([]);
      setIsAuthenticated(true);
      setError("");
      setScreen("admin-panel");
      void loadTeamQrCards();
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Přihlášení administrátora se nezdařilo.");
    } finally {
      loginInProgressRef.current = false;
      setIsLoggingIn(false);
    }
  };

  // Ukončí relaci na serveru i Firebase a vrátí aplikaci na přihlášení.
  const handleLogout = async () => {
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Odhlášení se nezdařilo.");
      const [{ signOut }, auth] = await Promise.all([
        import("firebase/auth"),
        getFirebaseAuth(),
      ]);
      await signOut(auth);
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : "Odhlášení se nezdařilo.");
      return;
    }
    setIsAuthenticated(false);
    setIsOwnerAdmin(false);
    setAdminTab("teams");
    lastPersistedStateRef.current = null;
    setTeamId(null);
    setGameState(emptyGameState);
    setSaveError("");
    setIsSavingGameState(false);
    setTeamForm({ name: "", password: "" });
    setAdminForm({ email: "", password: "" });
    setError("");
    setScreen("team-login");
  };

  // Odešle administrátorský příkaz pro spuštění, pauzu nebo restart hry.
  const handleGameControl = async (action: "start" | "restart" | "stop" | "resume" | "reopen") => {
    if (action === "stop" && !window.confirm(
      "Pozastavit hru? Všem týmům se zobrazí informace o pozastavení a budou čekat, dokud hlavní administrátor hru znovu nespustí.",
    )) {
      return;
    }
    if (action === "restart" && !window.confirm(
      "Restartovat výpravu? Všem týmům se vynuluje čas a postup, aktivní přepady se zruší a dosavadní důkazy se archivují. Týmy zůstanou zachované.",
    )) {
      return;
    }
    if (action === "reopen" && !window.confirm(
      "Znovu otevřít hru? Výsledky se skryjí a týmům zůstane jejich dosavadní postup.",
    )) {
      return;
    }
    setGameControlBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/game-control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const result = await response.json() as { state?: GameState; error?: string };
      if (!response.ok || !result.state) {
        throw new Error(result.error ?? "Stav hry se nepodařilo změnit.");
      }
      const state = normalizeGameState(result.state);
      lastPersistedStateRef.current = JSON.stringify(state);
      setGameState(state);
      setSaveError("");
    } catch (controlError) {
      setError(controlError instanceof Error ? controlError.message : "Stav hry se nepodařilo změnit.");
    } finally {
      setGameControlBusy(false);
    }
  };

  // Provede nouzovou zprávu, ruční zásah nebo uzavření hry hlavním adminem.
  const handleOwnerAction = async (
    action:
      | { action: "emergency-message"; message: string }
      | { action: "clear-emergency-message" }
      | { action: "intervene"; teamId: string; stationId: string; completed: boolean }
      | { action: "close-game" },
  ) => {
    const isEmergencyAction = action.action === "emergency-message" || action.action === "clear-emergency-message";
    if ((!isOwnerAdmin && !isEmergencyAction) || ownerActionBusy) return;
    if (action.action === "close-game" && !window.confirm(
      "Uzavřít hru a vyhlásit výsledky? Týmy už potom nebudou moci pokračovat a výsledky nepůjde změnit.",
    )) return;

    setOwnerActionBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/owner-controls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
      });
      const result = await response.json() as { state?: GameState; error?: string };
      if (!response.ok || !result.state) {
        throw new Error(result.error ?? "Zásah hlavního admina se nepodařilo provést.");
      }
      const state = normalizeGameState(result.state);
      lastPersistedStateRef.current = JSON.stringify(state);
      setGameState(state);
      setSaveError("");
      if (action.action === "emergency-message") setEmergencyDraft("");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Zásah hlavního admina se nepodařilo provést.");
    } finally {
      setOwnerActionBusy(false);
    }
  };

  // Validuje odpověď týmu, nahraje případný důkaz a odešle stanoviště.
  const submitTeamAnswer = async (station: Station) => {
    if (!activeTeam) return;
    if (submittingStationId === station.id) return;

    if (station.order !== nextOrder || !activeTeam.scannedStationIds.includes(station.id)) {
      setError("Nejdříve naskenujte QR kód tohoto stanoviště.");
      return;
    }

    if (
      gameState.submissions.some(
        (submission) =>
          submission.teamId === activeTeam.id &&
          submission.stationId === station.id &&
          submission.status === "pending" &&
          !submission.archivedAt,
      )
    ) {
      setError("Tento úkol už čeká na schválení.");
      return;
    }

    const formAnswers = formDrafts[station.id] ?? {};
    const content = station.type === "form" ? JSON.stringify(formAnswers) : drafts[station.id] ?? "";
    const isMediaSubmission = station.type === "photo" || station.type === "video";
    if (station.type === "photo" || station.type === "video") {
      if (!mediaFiles[station.id]) {
        setError("Nejprve nahrajte soubor.");
        return;
      }
    } else if (
      !content.trim() ||
      (station.type === "form" && (station.formQuestions ?? []).some((question) => !formAnswers[question.id]?.trim()))
    ) {
      setError("Vyplňte odpověď před odesláním.");
      return;
    }

    setSubmittingStationId(station.id);
    setError("");

    try {
      let mediaUrl: string | undefined;
      if (isMediaSubmission) {
        const file = mediaFiles[station.id];
        const activeTeam = gameState.teams.find((team) => team.id === teamId);
        if (!activeTeam) throw new Error("Přihlášený tým nebyl nalezen.");
        mediaUrl = await uploadTeamMedia(file, activeTeam.id);
      }

      // Odevzdání se ukládá až po dokončení případného nahrání důkazu.
      const response = await fetch("/api/team/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stationId: station.id, content, ...(mediaUrl ? { mediaUrl } : {}) }),
      });
      const result = await response.json() as {
        submission?: Submission;
        team?: Pick<Team, "id" | "completedStations" | "scannedStationIds">;
        error?: string;
      };
      if (!response.ok || !result.submission) {
        throw new Error(result.error ?? "Úkol se nepodařilo odeslat.");
      }
      const submittedAnswer = result.submission;
      setGameState((previous) => {
        const safePrevious = normalizeGameState(previous);
        return {
          ...safePrevious,
          teams: result.team
            ? safePrevious.teams.map((team) =>
                team.id === result.team?.id ? { ...team, ...result.team } : team,
              )
            : safePrevious.teams,
          submissions: [...safePrevious.submissions, submittedAnswer],
        };
      });
      setMediaFiles((current) => {
        const next = { ...current };
        delete next[station.id];
        return next;
      });
      setMediaPreviews((current) => {
        const next = { ...current };
        delete next[station.id];
        return next;
      });
      setScanMessage(station.requiresApproval
        ? "Úkol byl odeslán ke schválení. Po schválení dostanete nápovědu k dalšímu stanovišti."
        : "Úkol je splněný. Můžete pokračovat na další stanoviště.");
      setSelectedStationId(
        station.requiresApproval
          ? station.id
          : gameState.stations.find((item) => item.order === station.order + 1)?.id ?? station.id,
      );
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Úkol se nepodařilo odeslat.");
    } finally {
      setSubmittingStationId(null);
    }
  };

  // Přepne tým z QR skenování na ruční zadání UID.
  const handleManualUid = () => {
    setScannerOpen(false);
    setManualUidDraft("");
    setManualUidOpen(true);
    setError("");
  };

  // Ověří soubor přepadu a spravuje jeho lokální náhled.
  const handleFlashFileUpload = (file: File | null) => {
    if (flashMediaPreview) {
      URL.revokeObjectURL(flashMediaPreview);
      mediaPreviewUrlsRef.current = mediaPreviewUrlsRef.current.filter((url) => url !== flashMediaPreview);
    }
    setFlashMediaFile(null);
    setFlashMediaPreview("");
    if (!file) return;
    const allowedTypes = [
      "image/jpeg", "image/png", "image/webp", "image/gif", "image/avif",
      "video/mp4", "video/webm", "video/quicktime",
    ];
    if (!allowedTypes.includes(file.type)) {
      setError("Použijte fotografii JPG, PNG, WebP, GIF nebo AVIF, případně video MP4, WebM či MOV.");
      return;
    }
    if (file.size === 0 || file.size > 100 * 1024 * 1024) {
      setError("Soubor musí mít velikost do 100 MB.");
      return;
    }
    const preview = URL.createObjectURL(file);
    mediaPreviewUrlsRef.current.push(preview);
    setFlashMediaFile(file);
    setFlashMediaPreview(preview);
    setError("");
  };

  // Ověří ručně zadané UID a předá ho stejnému toku jako QR sken.
  const submitManualUid = () => {
    if (!isValidUid(manualUidDraft)) {
      setScanMessage("QR kód se nedaří načíst?");
      setError("UID musí mít přesně 8 znaků. Povolené jsou písmena a číslice.");
      return;
    }

    setManualUidOpen(false);
    handleScanResult(manualUidDraft);
  };

  // Odešle rozhodnutí správce a aktualizuje stav i navazující stanoviště.
  const handleSubmissionDecision = async (submissionId: string, status: "approved" | "rejected", comment?: string) => {
    setError("");
    try {
      const response = await fetch("/api/admin/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId, status, comment }),
      });
      const result = await response.json() as { state?: GameState; error?: string };
      if (!response.ok || !result.state) {
        throw new Error(result.error ?? "Odevzdání se nepodařilo zpracovat.");
      }
      const state = normalizeGameState(result.state);
      lastPersistedStateRef.current = JSON.stringify(state);
      setGameState(state);
      const reviewed = state.submissions.find((submission) => submission.id === submissionId);
      const station = getStationById(state.stations, reviewed?.stationId);
      if (status === "approved" && station) {
        const nextStation = state.stations.find((item) => item.order === station.order + 1);
        setSelectedStationId(nextStation?.id ?? station.id);
      }
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : "Odevzdání se nepodařilo zpracovat.");
    }
  };

  // Zkontroluje formulář a přidá nové stanoviště do herního stavu.
  const handleAddStation = (qrOnly = false) => {
    if (!qrOnly && (!adminStationForm.title.trim() || !adminStationForm.task.trim())) {
      setError("Vyplňte název a zadání úkolu.");
      return;
    }
    const uid = adminStationForm.uid.trim().toUpperCase() || createUniqueStationUid(gameState.stations);
    if (!isValidUid(uid)) {
      setError("UID musí obsahovat přesně 8 písmen nebo číslic.");
      return;
    }
    if (gameState.stations.some((station) => station.id !== editingStationId && station.uid.toUpperCase() === uid)) {
      setError("Toto UID už používá jiné stanoviště. Vygenerujte nové.");
      return;
    }
    const options = [...new Set(adminStationForm.optionsText
      .split("\n")
      .map((option) => option.trim())
      .filter(Boolean))];
    if (!qrOnly && adminStationForm.type === "multiple-choice" && options.length < 2) {
      setError("Výběr odpovědi potřebuje alespoň dvě možnosti, každou na samostatný řádek.");
      return;
    }
    if (!qrOnly && adminStationForm.type === "multiple-choice" && adminStationForm.answer && !options.includes(adminStationForm.answer.trim())) {
      setError("Správná odpověď musí být jedna z uvedených možností.");
      return;
    }
    if (
      !qrOnly &&
      !adminStationForm.requiresApproval &&
      !["photo", "video", "form"].includes(adminStationForm.type) &&
      !adminStationForm.answer.trim()
    ) {
      setError("Při automatickém splnění zadejte správnou odpověď, kterou server ověří.");
      return;
    }
    if (!qrOnly && adminStationForm.type === "form" && adminStationForm.formQuestions.length === 0) {
      setError("Formulář potřebuje alespoň jednu přidanou otázku.");
      return;
    }

    const previousStation = gameState.stations.find((station) => station.id === editingStationId);
    const newStation: Station = {
      id: previousStation?.id ?? `station-${crypto.randomUUID().slice(0, 8)}`,
      order: previousStation?.order ?? gameState.stations.length + 1,
      title: qrOnly ? `Stanoviště ${gameState.stations.length + 1}` : adminStationForm.title.trim(),
      description: adminStationForm.description.trim(),
      clue: adminStationForm.clue.trim(),
      task: qrOnly ? "" : adminStationForm.task.trim(),
      uid,
      type: qrOnly ? "text" : adminStationForm.type,
      requiresApproval: qrOnly || adminStationForm.requiresApproval,
      ...(qrOnly ? { isDraft: true } : {}),
      instructions: adminStationForm.instructions,
      ...(!qrOnly && adminStationForm.answer.trim() ? { answer: adminStationForm.answer.trim() } : {}),
      ...(!qrOnly && adminStationForm.type === "multiple-choice" ? { options } : {}),
      ...(!qrOnly && adminStationForm.type === "form" ? { formQuestions: adminStationForm.formQuestions } : {}),
    };

    setGameState((previous) => {
      const safePrevious = normalizeGameState(previous);
      return {
        ...safePrevious,
        stations: previousStation
          ? safePrevious.stations.map((station) => station.id === previousStation.id ? newStation : station)
          : [...safePrevious.stations, newStation],
        events: [
          createEvent(
            previousStation
              ? `Admin upravil stanoviště ${newStation.title}.`
              : qrOnly
                ? `Admin připravil QR pro stanoviště ${newStation.title}.`
                : `Admin přidal nové stanoviště ${newStation.title}.`,
            "info",
          ),
          ...safePrevious.events,
        ].slice(0, 12),
      };
    });
    setVisibleStationQr(newStation.id);
    if (!previousStation) setStationPage(Math.floor(gameState.stations.length / managementPageSize));
    setIsStationDialogOpen(false);
    setEditingStationId(null);

    setAdminStationForm({
      title: "",
      description: "",
      clue: "",
      task: "",
      uid: "",
      type: "text",
      instructions: "",
      requiresApproval: true,
      answer: "",
      optionsText: "",
      formQuestions: [],
      questionDraft: { label: "", type: "text", optionsText: "", answer: "" },
    });
    setError("");
  };

  // Vytvoří tým na serveru a následně vygeneruje jeho přihlašovací QR.
  const handleAddTeam = async () => {
    const cleanedName = teamFormAdmin.name.trim();
    if (!cleanedName) {
      setError("Název týmu je povinný.");
      return;
    }
    if (!teamFormAdmin.qrCardId && teamFormAdmin.password.length < 8) {
      setError("Heslo týmu musí mít alespoň 8 znaků.");
      return;
    }
    if (isCreatingTeam) return;

    const qrCardId = teamFormAdmin.qrCardId;
    const newTeamId = `team-${crypto.randomUUID().slice(0, 8)}`;
    const safePrevious = normalizeGameState(gameState);
    const nextState: GameState = {
      ...safePrevious,
      teams: [
        ...safePrevious.teams,
        {
          id: newTeamId,
          name: cleanedName.toUpperCase(),
          password: teamFormAdmin.password.trim() || crypto.randomUUID(),
          completedStations: [],
          scannedStationIds: [],
        },
      ],
      events: [
        createEvent(`Admin přidal nový tým ${cleanedName.toUpperCase()}.`, "success"),
        ...safePrevious.events,
      ].slice(0, 12),
    };

    setIsCreatingTeam(true);
    setError("");
    try {
      const saveResponse = await fetch("/api/game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextState),
      });
      const saveResult = await saveResponse.json() as { state?: GameState; error?: string };
      if (!saveResponse.ok || !saveResult.state) {
        throw new Error(saveResult.error ?? "Tým se nepodařilo uložit.");
      }
      const savedState = normalizeGameState(saveResult.state);
      lastPersistedStateRef.current = JSON.stringify(savedState);
      setGameState(savedState);
      setTeamPage(Math.floor((savedState.teams.length - 1) / managementPageSize));
      setTeamFormAdmin({ name: "", password: "", qrCardId: "" });

      if (qrCardId) {
        const assignResponse = await fetch("/api/admin/team-qr-cards", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cardId: qrCardId, teamId: newTeamId }),
        });
        const assignResult = await assignResponse.json() as { error?: string };
        if (!assignResponse.ok) {
          throw new Error(assignResult.error ?? "QR kartičku se nepodařilo přiřadit.");
        }
        setTeamQrCards((cards) => cards.map((card) =>
          card.id === qrCardId ? { ...card, teamId: newTeamId } : card,
        ));
        setIsTeamDialogOpen(false);
        return;
      }

      const qrResponse = await fetch(`/api/team/${encodeURIComponent(newTeamId)}/qr-login`, { method: "POST" });
      const qrResult = await qrResponse.json() as { token?: string; error?: string };
      if (!qrResponse.ok || !qrResult.token) {
        throw new Error(`Tým byl vytvořen, ale QR kód se nepodařilo vytvořit. ${qrResult.error ?? ""}`.trim());
      }
      const value = createTeamLoginUrl(qrResult.token);
      setGeneratedTeamQr({ teamId: newTeamId, value });
      setCreatedTeamQr({ teamId: newTeamId, name: cleanedName.toUpperCase(), value });
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Tým se nepodařilo vytvořit.");
    } finally {
      setIsCreatingTeam(false);
    }
  };

  // Odstraní tým po potvrzení a opraví aktuální stránku seznamu.
  const handleRemoveTeam = async (team: Team) => {
    if (!window.confirm(`Opravdu odstranit tým „${team.name}“? Odstraní se také jeho odevzdané úkoly a výsledky.`)) {
      return;
    }

    setDeletingTeamId(team.id);
    setError("");
    try {
      const response = await fetch(`/api/team/${encodeURIComponent(team.id)}`, { method: "DELETE" });
      const result = await response.json() as { error?: string; state?: GameState };
      if (!response.ok || !result.state) {
        throw new Error(result.error ?? "Tým se nepodařilo odstranit.");
      }
      const state = normalizeGameState(result.state);
      lastPersistedStateRef.current = JSON.stringify(state);
      setGameState(state);
      setTeamQrCards((cards) => cards.map((card) =>
        card.teamId === team.id ? { ...card, teamId: null } : card,
      ));
      setTeamPage((page) => Math.min(page, Math.max(0, Math.ceil(state.teams.length / managementPageSize) - 1)));
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Tým se nepodařilo odstranit.");
    } finally {
      setDeletingTeamId(null);
    }
  };

  // Načte aktuální seznam správců a zobrazí případnou chybu načtení.
  const loadManagers = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/managers", { cache: "no-store" });
      const result = await response.json() as { managers?: typeof managers; error?: string };
      if (!response.ok || !result.managers) throw new Error(result.error ?? "Správce se nepodařilo načíst.");
      setManagers(result.managers);
      setManagerError("");
    } catch (loadError) {
      setManagerError(loadError instanceof Error ? loadError.message : "Správce se nepodařilo načíst.");
    }
  }, []);

  const handleCreateTeamQrCard = async () => {
    if (isCreatingTeamQrCard) return;
    setIsCreatingTeamQrCard(true);
    setError("");
    try {
      const response = await fetch("/api/admin/team-qr-cards", { method: "POST" });
      const result = await response.json() as { card?: TeamQrCard; token?: string; error?: string };
      if (!response.ok || !result.card || !result.token) {
        throw new Error(result.error ?? "QR kartičku se nepodařilo vytvořit.");
      }
      const card = result.card;
      setTeamQrCards((cards) => [...cards, card]);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "QR kartičku se nepodařilo vytvořit.");
    } finally {
      setIsCreatingTeamQrCard(false);
    }
  };

  const handleRemoveTeamQrCard = async (cardId: string) => {
    if (!window.confirm("Odebrat nepřiřazenou QR kartičku? Její vytištěný QR pak přestane fungovat.")) return;
    setError("");
    try {
      const response = await fetch(`/api/admin/team-qr-cards?id=${encodeURIComponent(cardId)}`, { method: "DELETE" });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "QR kartičku se nepodařilo odebrat.");
      setTeamQrCards((cards) => cards.filter((card) => card.id !== cardId));
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "QR kartičku se nepodařilo odebrat.");
    }
  };

  // Vytvoří podřízeného správce a obnoví seznam po úspěchu.
  const handleCreateManager = async () => {
    if (managerBusy) return;
    setManagerBusy(true);
    setManagerError("");
    try {
      const response = await fetch("/api/admin/managers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(managerForm),
      });
      const result = await response.json() as { managers?: typeof managers; error?: string };
      if (!response.ok || !result.managers) throw new Error(result.error ?? "Správce se nepodařilo vytvořit.");
      setManagers(result.managers);
      setManagerForm({ username: "", password: "" });
    } catch (createError) {
      setManagerError(createError instanceof Error ? createError.message : "Správce se nepodařilo vytvořit.");
    } finally {
      setManagerBusy(false);
    }
  };

  // Odebere vybraného správce po potvrzení a aktualizuje seznam účtů.
  const handleDeleteManager = async (manager: { id: string; username: string }) => {
    if (!window.confirm(`Odebrat správce „${manager.username}“? Bude okamžitě odhlášen.`)) return;
    setManagerBusy(true);
    setManagerError("");
    try {
      const response = await fetch(`/api/admin/managers?id=${encodeURIComponent(manager.id)}`, { method: "DELETE" });
      const result = await response.json() as { managers?: typeof managers; error?: string };
      if (!response.ok || !result.managers) throw new Error(result.error ?? "Správce se nepodařilo odebrat.");
      setManagers(result.managers);
    } catch (deleteError) {
      setManagerError(deleteError instanceof Error ? deleteError.message : "Správce se nepodařilo odebrat.");
    } finally {
      setManagerBusy(false);
    }
  };

  // Prohodí stanoviště se sousedem a přepočítá jejich pořadí.
  const moveStation = (stationId: string, direction: "up" | "down") => {
    setGameState((previous) => {
      const nextStations = [...previous.stations];
      const index = nextStations.findIndex((station) => station.id === stationId);
      if (index === -1) return previous;
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= nextStations.length) return previous;

      [nextStations[index], nextStations[targetIndex]] = [nextStations[targetIndex], nextStations[index]];

      return {
        ...previous,
        stations: nextStations.map((station, orderIndex) => ({
          ...station,
          order: orderIndex + 1,
        })),
      };
    });
  };

  // Odebere stanoviště a zachová souvislé pořadí zbývajících položek.
  const removeStation = (stationId: string) => {
    setStationPage((page) => Math.min(page, Math.max(0, Math.ceil((gameState.stations.length - 1) / managementPageSize) - 1)));
    setGameState((previous) => ({
      ...previous,
      stations: previous.stations
        .filter((station) => station.id !== stationId)
        .map((station, index) => ({ ...station, order: index + 1 })),
    }));
  };

  // Ověří cílové týmy a přiřadí jim nový administrátorský přepad.
  const launchFlashMission = () => {
    const title = flashMissionForm.title.trim();
    const description = flashMissionForm.description.trim();
    if (!title || !description) {
      setError("Vyplňte název i konkrétní zadání přepadového úkolu.");
      return false;
    }
    const selectedTeams =
      flashMissionForm.targets === "all"
        ? gameState.teams.map((team) => team.id)
        : flashMissionForm.targetTeamIds;
    if (selectedTeams.length === 0) {
      setError("Vyberte alespoň jeden tým pro přepadový úkol.");
      return false;
    }
    const alreadyBusyTeams = gameState.teams.filter(
      (team) => selectedTeams.includes(team.id) && team.flashMissionId,
    );
    if (alreadyBusyTeams.length > 0) {
      setError(`Nejprve vyřešte aktivní přepad u týmů: ${alreadyBusyTeams.map((team) => team.name).join(", ")}.`);
      return false;
    }

    const mission: FlashMission = {
      id: `mission-${crypto.randomUUID().slice(0, 8)}`,
      title,
      description,
      type: flashMissionForm.type,
      targetMode: flashMissionForm.targets === "all" ? "all" : "specific",
      targetTeamIds: selectedTeams,
      requiresApproval: flashMissionForm.requiresApproval,
      instructions: "Toto je přepadový úkol. Celý běžný režim je uzamčen, dokud úkol nevyplníte.",
    };

    setGameState((previous) => {
      const safePrevious = normalizeGameState(previous);
      return {
        ...safePrevious,
        flashMissions: [...safePrevious.flashMissions, mission],
        teams: safePrevious.teams.map((team) =>
          selectedTeams.includes(team.id)
            ? { ...team, flashMissionId: mission.id }
            : team,
        ),
        events: [
          createEvent(`Spuštěn přepadový úkol ${mission.title}.`, "warning"),
          ...safePrevious.events,
        ].slice(0, 12),
      };
    });

    setFlashMissionForm({
      title: "",
      description: "",
      type: "text",
      targets: "all",
      targetTeamIds: [],
      requiresApproval: true,
    });
    setIsFlashDialogOpen(false);
    setError("");
    return true;
  };

  // Odešle text či médium k právě aktivnímu týmovému přepadovému úkolu.
  const submitFlashMission = async (team: Team) => {
    if (!team.flashMissionId) return;
    const mission = gameState.flashMissions.find((item) => item.id === team.flashMissionId);
    const missionNeedsMedia = mission?.type === "photo" || mission?.type === "video";
    if (missionNeedsMedia && !flashMediaFile) {
      setError(mission?.type === "video" ? "Nejprve nahrajte video k přepadovému úkolu." : "Nejprve nahrajte fotografii k přepadovému úkolu.");
      return;
    }
    if (!missionNeedsMedia && !flashDraft.trim()) {
      setError("Napište odpověď před odesláním.");
      return;
    }

    setIsSubmittingFlash(true);
    setError("");
    try {
      const mediaUrl = missionNeedsMedia && flashMediaFile
        ? await uploadTeamMedia(flashMediaFile, team.id)
        : undefined;
      const response = await fetch("/api/team/flash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: missionNeedsMedia ? "" : flashDraft,
          ...(mediaUrl ? { mediaUrl } : {}),
        }),
      });
      const result = await response.json() as { state?: GameState; error?: string };
      if (!response.ok || !result.state) {
        throw new Error(result.error ?? "Přepadový úkol se nepodařilo odeslat.");
      }
      const state = normalizeGameState(result.state);
      lastPersistedStateRef.current = JSON.stringify(state);
      setGameState(state);
      if (flashMediaPreview) {
        URL.revokeObjectURL(flashMediaPreview);
        mediaPreviewUrlsRef.current = mediaPreviewUrlsRef.current.filter((url) => url !== flashMediaPreview);
      }
      setFlashMediaFile(null);
      setFlashMediaPreview("");
      setFlashDraft("");
    } catch (missionError) {
      setError(missionError instanceof Error ? missionError.message : "Přepadový úkol se nepodařilo odeslat.");
    } finally {
      setIsSubmittingFlash(false);
    }
  };

  // Odešle soupeřovu týmu přepad včetně zvoleného typu důkazu.
  const sendTeamAmbush = async () => {
    if (!teamAmbushForm.targetTeamId || !teamAmbushForm.title.trim() || !teamAmbushForm.description.trim()) {
      setError("Vyberte soupeře a zadejte název i zadání přepadu.");
      return;
    }
    setTeamAmbushBusy(true);
    setError("");
    try {
      const response = await fetch("/api/team/ambush", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetTeamId: teamAmbushForm.targetTeamId,
          title: teamAmbushForm.title,
          description: teamAmbushForm.description,
          type: teamAmbushForm.type,
        }),
      });
      const result = await response.json() as { state?: GameState; error?: string };
      if (!response.ok || !result.state) {
        throw new Error(result.error ?? "Přepad se nepodařilo odeslat.");
      }
      const state = normalizeGameState(result.state);
      lastPersistedStateRef.current = JSON.stringify(state);
      setGameState(state);
      setTeamAmbushForm({ targetTeamId: "", title: "", description: "", type: "photo" });
    } catch (ambushError) {
      setError(ambushError instanceof Error ? ambushError.message : "Přepad se nepodařilo odeslat.");
    } finally {
      setTeamAmbushBusy(false);
    }
  };

  // Ověří médium pro stanoviště a aktualizuje soubor i jeho náhled.
  const handleFileUpload = (stationId: string, file: File | null) => {
    if (!file) return;

    setMediaFiles((previous) => {
      const next = { ...previous };
      delete next[stationId];
      return next;
    });
    setMediaPreviews((previous) => {
      const next = { ...previous };
      delete next[stationId];
      return next;
    });
    setDrafts((previous) => {
      const next = { ...previous };
      delete next[stationId];
      return next;
    });

    const supportedTypes = new Set([
      "image/jpeg", "image/png", "image/webp", "image/gif", "image/avif",
      "video/mp4", "video/webm", "video/quicktime",
    ]);
    if (!supportedTypes.has(file.type)) {
      setError("Použijte fotografii JPG, PNG, WebP, GIF nebo AVIF, případně video MP4, WebM či MOV.");
      return;
    }
    if (file.size === 0 || file.size > 100 * 1024 * 1024) {
      setError("Soubor musí mít velikost do 100 MB.");
      return;
    }

    const preview = URL.createObjectURL(file);
    mediaPreviewUrlsRef.current.push(preview);
    setMediaFiles((previous) => ({ ...previous, [stationId]: file }));
    setMediaPreviews((previous) => ({ ...previous, [stationId]: preview }));
    setDrafts((previous) => ({ ...previous, [stationId]: file.name }));
    setError("");
  };

  const activeFlashMission =
    activeTeam && activeTeam.flashMissionId
      ? gameState.flashMissions.find((mission) => mission.id === activeTeam.flashMissionId && !mission.archivedAt)
      : null;
  const activeFlashSubmission = activeTeam && activeFlashMission
    ? [...gameState.submissions].reverse().find(
        (submission) =>
          submission.teamId === activeTeam.id && submission.missionId === activeFlashMission.id,
      )
    : undefined;

  const pendingSubmissions = gameState.submissions.filter(
    (submission) => submission.status === "pending" && !submission.archivedAt,
  );
  const mediaSubmissions = [...gameState.submissions]
    .filter((submission) => isStoredMediaUrl(submission.mediaUrl))
    .sort((first, second) => second.createdAt.localeCompare(first.createdAt));
  const galleryPageSize = 12;
  const galleryPageCount = Math.ceil(mediaSubmissions.length / galleryPageSize);
  const visibleMediaSubmissions = mediaSubmissions.slice(
    galleryPage * galleryPageSize,
    (galleryPage + 1) * galleryPageSize,
  );
  const managementPageSize = 12;
  const teamPageCount = Math.ceil(gameState.teams.length / managementPageSize);
  const stationPageCount = Math.ceil(gameState.stations.length / managementPageSize);
  const visibleTeams = gameState.teams.slice(teamPage * managementPageSize, (teamPage + 1) * managementPageSize);
  const visibleStations = gameState.stations.slice(stationPage * managementPageSize, (stationPage + 1) * managementPageSize);
  const completedStationsCount = activeTeam ? activeTeam.completedStations.length : 0;
  const hasFinishedGame = Boolean(activeTeam && gameState.stations.length > 0 && completedStationsCount >= gameState.stations.length);
  const nextRouteStation = [...gameState.stations]
    .sort((first, second) => first.order - second.order)
    .find((station) => !activeTeam?.completedStations.includes(station.id));
  const currentTeamPendingSubmission = activeTeam
    ? [...gameState.submissions].reverse().find(
        (submission) => submission.teamId === activeTeam.id && submission.status === "pending" && !submission.archivedAt,
      )
    : undefined;

  useEffect(() => {
    if (!stationResultAnimation) return;
    const timeout = window.setTimeout(() => setStationResultAnimation(null), 1100);
    return () => window.clearTimeout(timeout);
  }, [stationResultAnimation]);

  useEffect(() => {
    if (!activeTeam) {
      previousTeamProgressRef.current = null;
      return;
    }

    const previousProgress = previousTeamProgressRef.current;
    if (previousProgress?.teamId === activeTeam.id) {
      const newlyCompletedStationId = activeTeam.completedStations.find(
        (stationId) => !previousProgress.completedStationIds.has(stationId),
      );
      const newlyCompletedStation = gameState.stations.find(
        (station) => station.id === newlyCompletedStationId,
      );
      if (newlyCompletedStation) {
        setStationResultAnimation({
          teamId: activeTeam.id,
          result: "completed",
          key: newlyCompletedStation.id,
        });
      }
    }

    previousTeamProgressRef.current = {
      teamId: activeTeam.id,
      completedStationIds: new Set(activeTeam.completedStations),
    };
  }, [activeTeam, gameState.stations]);

  useEffect(() => {
    const previousStatuses = previousSubmissionStatusesRef.current;
    const rejectedSubmission = activeTeam
      ? [...gameState.submissions].reverse().find(
          (submission) =>
            submission.teamId === activeTeam.id &&
            submission.status === "rejected" &&
            !submission.archivedAt &&
            previousStatuses.get(submission.id) === "pending",
        )
      : undefined;

    previousSubmissionStatusesRef.current = new Map(
      gameState.submissions.map((submission) => [submission.id, submission.status]),
    );

    if (rejectedSubmission) {
      setStationResultAnimation({
        teamId: rejectedSubmission.teamId,
        result: "rejected",
        key: rejectedSubmission.id,
      });
    }
  }, [activeTeam, gameState.submissions]);

  useEffect(() => {
    if (presentationIndex === null) return;
    // Klávesnice zavírá prezentaci nebo přechází mezi položkami galerie.
    const handlePresentationKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPresentationIndex(null);
      if (event.key === "ArrowLeft") setPresentationIndex((index) => index === null ? 0 : Math.max(0, index - 1));
      if (event.key === "ArrowRight") {
        setPresentationIndex((index) => index === null ? 0 : Math.min(mediaSubmissions.length - 1, index + 1));
      }
    };
    window.addEventListener("keydown", handlePresentationKey);
    return () => window.removeEventListener("keydown", handlePresentationKey);
  }, [mediaSubmissions.length, presentationIndex]);

  if (isLoadingGameState) {
    return (
      <main className="auth-loading flex min-h-screen items-center justify-center">
        <div className="auth-loading-mark">Podzimky 2026</div>
      </main>
    );
  }

  return (
    <main className="app-root min-h-screen bg-[#f4f5f7] text-[#202633]">
      {screen === "team-login" && (
        <div className="auth-page login-page">
          <div className="auth-photo-panel" aria-hidden="true">
            <Image
              src={authVisualBackgrounds[authVisualMode]}
              alt=""
              fill
              sizes="(min-width: 901px) 56vw, 100vw"
              quality={95}
              className="auth-photo"
            />
          </div>
          <div aria-hidden="true" className="auth-photo-shade" />
          <div className="auth-frame">
            <header className="auth-topbar">
              <AuthVisualModePicker mode={authVisualMode} onChange={setAuthVisualMode} />
              <button
                className="auth-quiet-button"
                onClick={() => setScreen("admin-login")}
              >
                Administrace
              </button>
            </header>

            <div className="auth-layout">
              <section className="auth-story" aria-labelledby="team-welcome">
                <h1 id="team-welcome">Podzimky 2026</h1>
              </section>

              <section className="login-card auth-form" aria-label="Přihlášení týmu">
                <div className="auth-fields">
                  <label className="auth-label">
                    Tým
                    <input
                      ref={teamNameInputRef}
                      value={teamForm.name}
                      onChange={(event) => setTeamForm((current) => ({ ...current, name: event.target.value }))}
                      className="auth-input"
                      autoComplete="username"
                      placeholder="Zadejte název týmu"
                    />
                  </label>

                  <label className="auth-label">
                    Heslo
                    <span className="auth-password-wrap">
                      <input
                        ref={teamPasswordInputRef}
                        type={showTeamPassword ? "text" : "password"}
                        value={teamForm.password}
                        onChange={(event) => setTeamForm((current) => ({ ...current, password: event.target.value }))}
                        className="auth-input"
                        autoComplete="current-password"
                        placeholder="Zadejte heslo týmu"
                      />
                      <button
                        type="button"
                        className="auth-password-toggle"
                        onClick={() => setShowTeamPassword((visible) => !visible)}
                        aria-label={showTeamPassword ? "Skrýt heslo" : "Zobrazit heslo"}
                        aria-pressed={showTeamPassword}
                      >
                        {showTeamPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </span>
                  </label>

                  {error ? <p className="auth-error">{error}</p> : null}

                  <button onClick={handleTeamLogin} className="auth-submit" disabled={isLoggingIn}>
                    {isLoggingIn ? "Přihlašuji…" : "Vstoupit"} {!isLoggingIn && <ArrowRight size={18} />}
                  </button>
                  <div className="auth-login-divider"><span>nebo</span></div>
                  <button
                    type="button"
                    className="auth-qr-login"
                    disabled={isLoggingIn}
                    onClick={() => {
                      setError("");
                      setTeamQrScanMessage("Umístěte přihlašovací QR kód do rámečku.");
                      setTeamQrScannerOpen(true);
                    }}
                  >
                    <QrCode size={17} /> Přihlásit přes QR kód
                  </button>
                </div>
              </section>
            </div>
          </div>
        </div>
      )}

      {screen === "admin-login" && (
        <div className="auth-page auth-admin-page">
          <div className="auth-photo-panel" aria-hidden="true">
            <Image
              src={authVisualBackgrounds[authVisualMode]}
              alt=""
              fill
              sizes="(min-width: 901px) 56vw, 100vw"
              quality={95}
              className="auth-photo"
            />
          </div>
          <div aria-hidden="true" className="auth-photo-shade" />
          <div className="auth-frame">
            <header className="auth-topbar">
              <AuthVisualModePicker mode={authVisualMode} onChange={setAuthVisualMode} />
              <button className="auth-quiet-button" onClick={() => setScreen("team-login")}>
                <ArrowLeft size={16} /> Zpět
              </button>
            </header>

            <div className="auth-layout">
              <section className="auth-story" aria-labelledby="admin-welcome">
                <h1 id="admin-welcome">Podzimky 2026</h1>
              </section>

              <section className="login-card auth-form" aria-label="Přihlášení administrátora">
                <div className="auth-fields">
                  <label className="auth-label">
                    E-mail
                    <input
                      ref={adminUsernameInputRef}
                      type="email"
                      value={adminForm.email}
                      onChange={(event) => setAdminForm((current) => ({ ...current, email: event.target.value }))}
                      autoComplete="username"
                      placeholder="Zadejte e-mail administrátora"
                      className="auth-input"
                    />
                  </label>

                  <label className="auth-label">
                    Heslo
                    <span className="auth-password-wrap">
                      <input
                        ref={adminPasswordInputRef}
                        type={showAdminPassword ? "text" : "password"}
                        value={adminForm.password}
                        onChange={(event) => setAdminForm((current) => ({ ...current, password: event.target.value }))}
                        autoComplete="current-password"
                        placeholder="Zadejte heslo administrátora"
                        className="auth-input"
                      />
                      <button
                        type="button"
                        className="auth-password-toggle"
                        onClick={() => setShowAdminPassword((visible) => !visible)}
                        aria-label={showAdminPassword ? "Skrýt heslo" : "Zobrazit heslo"}
                        aria-pressed={showAdminPassword}
                      >
                        {showAdminPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </span>
                  </label>

                  {error ? <p className="auth-error">{error}</p> : null}

                  <button onClick={handleAdminLogin} className="auth-submit" disabled={isLoggingIn}>
                    {isLoggingIn ? "Přihlašuji…" : "Přihlásit se"}
                  </button>
                </div>
              </section>
            </div>
          </div>
        </div>
      )}

      {screen === "team-dashboard" && activeTeam && (
        gameState.gameClosedAt ? (
          <div className="team-viewport-scroll mx-auto flex min-h-screen max-w-2xl items-center justify-center px-4 py-10">
            <div className="w-full rounded-[30px] border border-[#d5a24a] bg-[#fff5df] p-8 shadow-[0_22px_55px_rgba(116,81,35,0.2)]">
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#8e5d1d]">Podzimky 2026</p>
              <h1 className="mt-3 text-3xl font-black text-[#281d15]">Výsledky hry</h1>
              <p className="mt-3 text-base text-[#5d4536]">Děkujeme za účast, {activeTeam.name}.</p>
              <p className="mt-2 text-sm text-[#756958]">
                Váš výsledek: {gameState.gameResults?.find((result) => result.teamId === activeTeam.id)?.completedStations ?? activeTeam.completedStations.length} / {gameState.stations.length} stanovišť
              </p>
              {gameState.emergencyMessage && (
                <div role="alert" className="mt-5 rounded-xl border border-[#dc9c77] bg-[#fff0e8] p-4 text-sm font-semibold text-[#78351e]">
                  <strong className="block">Nouzová zpráva</strong>
                  <span className="mt-1 block whitespace-pre-wrap">{gameState.emergencyMessage.message}</span>
                </div>
              )}
              <ol className="mt-6 space-y-2">
                {(gameState.gameResults ?? []).map((result) => (
                  <li key={result.teamId} className={classNames(
                    "flex items-center justify-between gap-3 rounded-xl border px-4 py-3",
                    result.teamId === activeTeam.id ? "border-[#d5a24a] bg-[#fffaf1]" : "border-[#e7d7b4] bg-white/70",
                  )}>
                    <span className="font-bold text-[#39291d]">{result.rank}. {result.teamName}</span>
                    <span className="text-sm text-[#72501f]">{result.completedStations} / {gameState.stations.length} stanovišť</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        ) : gameState.gameStoppedAt ? (
          <div className="team-viewport-scroll mx-auto flex min-h-screen max-w-xl items-center justify-center px-4 py-10">
            <div className="w-full rounded-[30px] border border-[#d5a24a] bg-[#fff5df] p-8 text-center shadow-[0_22px_55px_rgba(116,81,35,0.2)]">
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#8e5d1d]">Podzimky 2026</p>
              <h1 className="mt-3 text-3xl font-black text-[#281d15]">Hra je pozastavena</h1>
              <p className="mt-3 text-base text-[#5d4536]">{activeTeam.name}, vyčkejte na pokyn pořadatele.</p>
              <p className="mt-4 font-mono text-lg font-bold tabular-nums text-[#8b3329]">
                <ElapsedClock startedAt={gameState.gameStartedAt} stoppedAt={gameState.gameStoppedAt} pausedMs={gameState.gamePausedMs} />
              </p>
              {gameState.emergencyMessage && (
                <div role="alert" className="mt-5 rounded-xl border border-[#dc9c77] bg-[#fff0e8] p-4 text-left text-sm font-semibold text-[#78351e]">
                  <strong className="block">Nouzová zpráva</strong>
                  <span className="mt-1 block whitespace-pre-wrap">{gameState.emergencyMessage.message}</span>
                </div>
              )}
            </div>
          </div>
        ) :
        activeFlashMission ? (
          <div className="team-viewport-scroll mx-auto flex min-h-screen max-w-3xl items-center justify-center px-4 py-10">
            <div className="w-full rounded-[30px] border border-[#d5a24a] bg-[#fff5df] p-6 shadow-[0_22px_55px_rgba(116,81,35,0.2)] sm:p-9">
              {gameState.emergencyMessage && (
                <div role="alert" className="mb-5 rounded-xl border border-[#dc9c77] bg-[#fff0e8] p-4 text-sm font-semibold text-[#78351e]">
                  <div className="flex items-center gap-2"><AlertTriangle size={18} /> Nouzová zpráva pořadatele</div>
                  <p className="mt-1 whitespace-pre-wrap">{gameState.emergencyMessage.message}</p>
                </div>
              )}
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#8e5d1d]">Přepadový úkol</p>
              {activeFlashMission.sourceTeamName && (
                <p className="mt-2 text-sm font-semibold text-[#8e5d1d]">Přepad od týmu {activeFlashMission.sourceTeamName}</p>
              )}
              <h1 className="mt-3 text-3xl font-black text-[#281d15]">{activeFlashMission.title}</h1>
              <p className="mt-3 whitespace-pre-wrap text-base leading-relaxed text-[#5d4536]">{activeFlashMission.description}</p>
              <div className="mt-5 rounded-2xl border border-[#e7cf9e] bg-[#fffaf1] p-4 text-sm text-[#483b2e]">
                {activeFlashMission.type === "photo"
                  ? "Vyfoťte splnění úkolu a nahrajte fotografii."
                  : activeFlashMission.type === "video"
                    ? "Natočte splnění úkolu a nahrajte video."
                    : "Napište odpověď nebo popište, jak jste zadání splnili."}{" "}
                {activeFlashMission.requiresApproval
                  ? "Po odeslání ji zkontroluje pořadatel."
                  : "Po odeslání můžete pokračovat ve hře."}
              </div>
              {activeFlashSubmission?.status === "pending" ? (
                <p role="status" className="mt-6 rounded-2xl border border-[#e5ca8f] bg-[#fffaf1] p-4 font-semibold text-[#72501f]">
                  Odpověď odeslána. Čeká na schválení pořadatelem.
                </p>
              ) : (
                <>
                  {activeFlashSubmission?.status === "rejected" && (
                    <p role="alert" className="mt-5 rounded-xl bg-[#fbe5e1] p-3 text-sm text-[#693025]">
                      Odpověď nebyla schválena. {activeFlashSubmission.comment || "Upravte ji a odešlete znovu."}
                    </p>
                  )}
                  {error && <p role="alert" className="mt-4 rounded-xl bg-[#fbe5e1] p-3 text-sm text-[#693025]">{error}</p>}
                  {activeFlashMission.type === "photo" || activeFlashMission.type === "video" ? (
                    <div className="mt-5">
                      <label className="block text-sm font-bold text-[#483b2e]" htmlFor="flash-evidence">
                        {activeFlashMission.type === "video" ? "Video splnění" : "Fotografie splnění"}
                      </label>
                      <input
                        id="flash-evidence"
                        type="file"
                        accept={activeFlashMission.type === "video"
                          ? "video/mp4,video/webm,video/quicktime"
                          : "image/jpeg,image/png,image/webp,image/gif,image/avif"}
                        capture={activeFlashMission.type === "photo" ? "environment" : undefined}
                        onChange={(event) => handleFlashFileUpload(event.target.files?.[0] ?? null)}
                        className="mt-2 block w-full rounded-xl border border-[#dcc58f] bg-white p-3 text-sm"
                      />
                      {flashMediaPreview && (
                        activeFlashMission.type === "video" ? (
                          <video
                            controls
                            preload="metadata"
                            src={flashMediaPreview}
                            className="mt-3 max-h-72 w-full rounded-xl bg-black"
                          />
                        ) : (
                          <Image
                            src={flashMediaPreview}
                            alt="Náhled fotografie k přepadovému úkolu"
                            width={960}
                            height={640}
                            unoptimized
                            className="mt-3 max-h-72 w-full rounded-xl bg-[#f1ece4] object-contain"
                          />
                        )
                      )}
                    </div>
                  ) : (
                    <>
                      <label className="mt-5 block text-sm font-bold text-[#483b2e]" htmlFor="flash-answer">Vaše odpověď</label>
                      <textarea
                        id="flash-answer"
                        value={flashDraft}
                        onChange={(event) => setFlashDraft(event.target.value)}
                        maxLength={10_000}
                        rows={5}
                        className="mt-2 w-full rounded-2xl border border-[#dcc58f] bg-white p-4 text-base text-[#30251e] outline-none focus:ring-4 focus:ring-[#d59a39]/20"
                        placeholder="Popište řešení nebo splnění úkolu…"
                      />
                      <div className="mt-2 flex items-center justify-between text-xs text-[#806b4e]">
                        <span>Odpověď je potřeba vyplnit.</span><span>{flashDraft.length}/10 000</span>
                      </div>
                    </>
                  )}
                  <button
                    onClick={() => void submitFlashMission(activeTeam)}
                    disabled={((activeFlashMission.type === "photo" || activeFlashMission.type === "video") ? !flashMediaFile : !flashDraft.trim()) || isSubmittingFlash}
                    className="mt-5 w-full rounded-2xl bg-[#d59a39] px-4 py-3 text-base font-bold text-[#1d1a17] transition hover:bg-[#e2ad54] disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    {isSubmittingFlash
                      ? "Odesílám…"
                      : activeFlashMission.type === "photo" || activeFlashMission.type === "video"
                        ? "Odeslat důkaz"
                        : "Odeslat odpověď"}
                  </button>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="player-shell mx-auto max-w-5xl px-3 py-4 pb-24 sm:px-5 sm:py-6">
            {gameState.emergencyMessage && (
              <div role="alert" className="mb-4 rounded-xl border border-[#dc9c77] bg-[#fff0e8] p-4 text-sm font-semibold text-[#78351e] shadow-sm">
                <div className="flex items-center gap-2"><AlertTriangle size={18} /> Nouzová zpráva pořadatele</div>
                <p className="mt-1 whitespace-pre-wrap">{gameState.emergencyMessage.message}</p>
              </div>
            )}
            <header className="player-header sticky top-2 z-20 mb-5 rounded-2xl border p-4 text-[#1e293b] shadow-sm sm:px-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span aria-hidden="true" className="player-seal flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"><MapPin size={20} /></span>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-[0.17em] text-[#8c929b]">Podzimky 2026</p>
                    <h1 className="truncate text-lg font-bold tracking-tight text-[#1f2937] sm:text-xl">{activeTeam.name}</h1>
                    <div className="player-header-meta">
                      <span className="player-clock-label">Čas ve hře</span>
                      <ElapsedClock startedAt={gameState.gameStartedAt} stoppedAt={gameState.gameStoppedAt} pausedMs={gameState.gamePausedMs} className="player-clock inline-flex items-center gap-1 font-mono text-xs font-semibold tabular-nums text-[#8b3329]" />
                      <span className="player-status-pill" data-active={gameState.gameStartedAt ? "true" : "false"}>
                        {gameState.gameStartedAt ? "Hra běží" : "Čeká se na start"}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => void handleLogout()}
                  aria-label="Odhlásit se"
                  className="player-logout-button inline-flex items-center gap-2 rounded-xl border border-[#e4e7eb] bg-white px-3 py-2.5 text-xs font-semibold text-[#596273] transition hover:bg-[#f6f7f9] sm:text-sm"
                >
                  <LogOut size={16} /><span className="hidden sm:inline">Odhlásit se</span>
                </button>
                </div>
              </div>
              <div
                className="player-progress mt-4 border-t border-white/15 pt-3"
                role="progressbar"
                aria-label="Postup výpravy"
                aria-valuemin={0}
                aria-valuemax={gameState.stations.length}
                aria-valuenow={completedStationsCount}
              >
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="text-[#6f7783]">Splněná stanoviště</span>
                  <span className="font-semibold text-[#a4332b]">{completedStationsCount} z {gameState.stations.length}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-[#eceef1]">
                  <div
                    className="h-full rounded-full bg-[#a4332b] transition-all"
                    style={{ width: `${Math.min((completedStationsCount / Math.max(gameState.stations.length, 1)) * 100, 100)}%` }}
                  />
                </div>
              </div>
            </header>

            {!hasFinishedGame && (
              <section className="player-next-step" aria-label="Další krok výpravy">
                <span className="player-next-step-mark" aria-hidden="true">
                  {currentTeamPendingSubmission ? <Clock size={21} /> : <MapPin size={21} />}
                </span>
                <div className="player-next-step-copy">
                  <p>Teď udělejte toto</p>
                  <h2>
                    {!gameState.gameStartedAt
                      ? "Čeká se na společný start"
                      : currentTeamPendingSubmission
                        ? "Úkol čeká na schválení"
                        : nextRouteStation
                          ? activeTeam.scannedStationIds.includes(nextRouteStation.id)
                            ? `Splňte úkol · ${nextRouteStation.title}`
                            : `Najděte stanoviště ${nextRouteStation.order}`
                          : "Všechna stanoviště máte za sebou"}
                  </h2>
                  <span>
                    {!gameState.gameStartedAt
                      ? "Až pořadatel hru spustí, ukážeme vám trasu."
                      : currentTeamPendingSubmission
                        ? "Jakmile pořadatel odpověď schválí, můžete pokračovat."
                        : nextRouteStation && activeTeam.scannedStationIds.includes(nextRouteStation.id)
                          ? "QR kód už máte načtený. Pokračujte v plnění úkolu níže."
                          : nextRouteStation
                            ? "Jděte na správné místo a naskenujte tam QR kód stanoviště."
                            : "Skvělá práce. Dokončili jste celou trasu."}
                  </span>
                </div>
                {nextRouteStation && !currentTeamPendingSubmission && !activeTeam.scannedStationIds.includes(nextRouteStation.id) && gameState.gameStartedAt && (
                  <button
                    type="button"
                    onClick={() => {
                      setScanMessage("Spouštím zadní kameru…");
                      setScannerOpen(true);
                    }}
                    className="player-next-step-action"
                  >
                    <ScanLine size={17} /> Naskenovat QR kód
                  </button>
                )}
              </section>
            )}

            {(saveError || isSavingGameState) && (
              <div role={saveError ? "alert" : "status"} className={classNames(
                "mb-3 flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-xs font-semibold",
                saveError ? "bg-[#fce7e6] text-[#8b2d2d]" : "bg-[#f1eadb] text-[#745b35]",
              )}>
                <span>{saveError || "Ukládám postup…"}</span>
                {saveError && (
                  <button onClick={() => setSaveRevision((revision) => revision + 1)} className="shrink-0 underline underline-offset-2">
                    Zkusit znovu
                  </button>
                )}
              </div>
            )}

            {gameState.gameStartedAt && !gameState.gameStoppedAt && !gameState.gameClosedAt && (
              <details className="player-optional mb-4">
                <summary className="player-optional-summary">
                  <span>
                    <span className="player-optional-label">Vedlejší aktivita · volitelné</span>
                    <span className="player-optional-title">Vyzvat soupeřící tým</span>
                  </span>
                  <span className="player-optional-count">Využito {activeTeam.flashMissionsUsed ?? 0} ze 3</span>
                </summary>
                <section className="player-optional-content rounded-2xl border border-[#e7d8c0] bg-[#fffdfa] p-4 shadow-[0_8px_24px_rgba(29,25,20,0.06)] sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#8e5d1d]">Týmový přepad</p>
                      <h2 className="mt-1 text-lg font-bold text-[#241d1a]">Zadejte soupeři výzvu</h2>
                      <p className="mt-1 text-sm text-[#675d53]">
                        Využito {activeTeam.flashMissionsUsed ?? 0} ze 3 přepadů. Důkaz se uloží do galerie bez schvalování.
                      </p>
                    </div>
                  </div>
                  {(activeTeam.flashMissionsUsed ?? 0) >= 3 ? (
                    <p className="mt-4 rounded-xl bg-[#f5efe8] p-3 text-sm text-[#675d53]">
                      Všechny 3 přepady tohoto týmu už byly využity.
                    </p>
                  ) : gameState.ambushTargets?.length ? (
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <label className="block text-sm font-semibold text-[#4d3b2a]">
                        Soupeřící tým
                        <select
                          value={teamAmbushForm.targetTeamId}
                          onChange={(event) => setTeamAmbushForm((current) => ({ ...current, targetTeamId: event.target.value }))}
                          disabled={teamAmbushBusy}
                          className="mt-1 w-full rounded-xl border border-[#d8c6a2] bg-white p-3"
                        >
                          <option value="">Vyberte tým</option>
                          {gameState.ambushTargets.map((target) => (
                            <option key={target.id} value={target.id}>{target.name}</option>
                          ))}
                        </select>
                      </label>
                      <label className="block text-sm font-semibold text-[#4d3b2a]">
                        Důkaz splnění
                        <select
                          value={teamAmbushForm.type}
                          onChange={(event) => setTeamAmbushForm((current) => ({
                            ...current,
                            type: event.target.value === "video" ? "video" : "photo",
                          }))}
                          disabled={teamAmbushBusy}
                          className="mt-1 w-full rounded-xl border border-[#d8c6a2] bg-white p-3"
                        >
                          <option value="photo">Fotografie</option>
                          <option value="video">Video</option>
                        </select>
                      </label>
                      <label className="block text-sm font-semibold text-[#4d3b2a] sm:col-span-2">
                        Název výzvy
                        <input
                          value={teamAmbushForm.title}
                          onChange={(event) => setTeamAmbushForm((current) => ({ ...current, title: event.target.value }))}
                          maxLength={100}
                          disabled={teamAmbushBusy}
                          placeholder="Například: Znak výpravy"
                          className="mt-1 w-full rounded-xl border border-[#d8c6a2] bg-white p-3"
                        />
                      </label>
                      <label className="block text-sm font-semibold text-[#4d3b2a] sm:col-span-2">
                        Zadání
                        <textarea
                          value={teamAmbushForm.description}
                          onChange={(event) => setTeamAmbushForm((current) => ({ ...current, description: event.target.value }))}
                          maxLength={2000}
                          rows={3}
                          disabled={teamAmbushBusy}
                          placeholder="Popište, co má soupeř splnit a vyfotit nebo natočit."
                          className="mt-1 w-full rounded-xl border border-[#d8c6a2] bg-white p-3"
                        />
                      </label>
                      {error && <p role="alert" className="rounded-xl bg-[#fce7e6] p-3 text-sm text-[#8b2d2d] sm:col-span-2">{error}</p>}
                      <button
                        type="button"
                        onClick={() => void sendTeamAmbush()}
                        disabled={teamAmbushBusy || !teamAmbushForm.targetTeamId || !teamAmbushForm.title.trim() || !teamAmbushForm.description.trim()}
                        className="rounded-xl bg-[#843b2d] px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50 sm:col-span-2"
                      >
                        {teamAmbushBusy ? "Odesílám přepad…" : "Poslat přepad"}
                      </button>
                    </div>
                  ) : (
                    <p className="mt-4 rounded-xl bg-[#f5efe8] p-3 text-sm text-[#675d53]">
                      Teď není dostupný žádný soupeř bez aktivního přepadu.
                    </p>
                  )}
                </section>
              </details>
            )}

            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
              <section className="player-route order-2 rounded-2xl border border-[#e7d8c0] bg-[#fffdfa] p-3 shadow-[0_8px_24px_rgba(29,25,20,0.06)] lg:order-2">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-base font-bold text-[#241d1a]">Trasa</h2>
                  <span className="rounded-full bg-[#f5ebda] px-2.5 py-1 text-xs font-semibold text-[#795b34]">
                    {completedStationsCount} / {gameState.stations.length} hotovo
                  </span>
                </div>

                <details className="player-station-list">
                  <summary className="mb-2 cursor-pointer rounded-lg bg-[#faf5ec] px-3 py-2 text-xs font-semibold text-[#7c4a28]">
                    Zobrazit průběh trasy
                  </summary>
                  <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
                  {gameState.stations.map((station) => {
                    const isCompleted = activeTeam.completedStations.includes(station.id);
                    const isCurrent = selectedStationId === station.id;
                    const isAvailable = station.order === nextOrder;
                    const isScanned = activeTeam.scannedStationIds.includes(station.id);

                    return (
                      <button
                        key={station.id}
                        onClick={() => setSelectedStationId(station.id)}
                        disabled={!isCompleted && !isAvailable}
                        className={classNames(
                          "flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition",
                          isCompleted && "border-[#8bbd79] bg-[#edf9ec] text-[#234c2b]",
                          !isCompleted && isCurrent && "border-[#d59a39] bg-[#fff2dc] text-[#624010]",
                          !isCompleted && !isCurrent && isAvailable && "border-[#d9cab0] bg-[#faf6ef] text-[#3d3127]",
                          !isAvailable && "border-[#e4ddd3] bg-[#f7f4f1] text-[#8d8076] opacity-70",
                        )}
                      >
                        <span className="flex items-center gap-3">
                          <span className="text-base font-black">{isCompleted ? "✓" : isAvailable ? (isScanned ? "●" : "○") : "–"}</span>
                          <span>
                            <span className="block text-sm font-bold">Stanoviště {station.order}</span>
                            <span className="block text-xs opacity-80">
                              {isCompleted || isScanned ? station.title : isAvailable ? "Naskenujte QR kód" : "Uzamčeno"}
                            </span>
                          </span>
                        </span>
                        <span className="text-xs font-bold uppercase tracking-[0.14em]">
                          {isCompleted ? "Hotovo" : isAvailable ? (isScanned ? "Otevřeno" : "Čeká na QR") : "Zamčeno"}
                        </span>
                      </button>
                    );
                  })}
                  </div>
                </details>
              </section>

              <section className="player-mission order-1 overflow-hidden rounded-2xl border border-[#e4d4ba] bg-[#fffdfa] shadow-[0_12px_30px_rgba(29,25,20,0.08)] lg:order-1">
                {hasFinishedGame ? (
                  <div className="player-finish p-6 text-center sm:p-8">
                    <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#e8f5ed] text-[#25804a]"><CheckCircle2 size={30} /></span>
                    <p className="mt-4 text-xs font-bold uppercase tracking-[0.18em] text-[#8f3529]">Výprava dokončena</p>
                    <h2 className="mt-2 text-2xl font-bold text-[#2c211b]">Skvělá práce, {activeTeam.name}</h2>
                    <p className="mt-2 text-sm text-[#6d5b47]">Prošli jste všechna stanoviště.</p>
                  </div>
                ) : selectedStationId && (() => {
                  const station = getStationById(gameState.stations, selectedStationId);
                  if (!station) return null;

                  const isCompleted = activeTeam.completedStations.includes(station.id);
                  const isAvailable = station.order === nextOrder;
                  const isScanned = activeTeam.scannedStationIds.includes(station.id);
                  const latestSubmission = [...gameState.submissions].reverse().find(
                    (submission) => submission.teamId === activeTeam.id && submission.stationId === station.id && !submission.archivedAt,
                  );
                  const isPending = latestSubmission?.status === "pending";
                  return (
                    <div>
                      <div className="player-mission-banner flex items-center gap-4 px-4 py-4 sm:px-5">
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#e8c87f]/50 bg-[#e8c87f]/15 font-serif text-xl font-bold text-[#f4d992]">
                          {station.order.toString().padStart(2, "0")}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#efd9a7]">
                            {isCompleted ? "Splněno" : isPending ? "Čeká na kontrolu" : isScanned ? "Aktuální úkol" : `Další stanoviště · ${station.order}`}
                          </p>
                          <h2 className="mt-1 truncate text-xl font-bold text-white sm:text-2xl">
                            {isCompleted || isScanned ? station.title : "Nápověda k místu"}
                          </h2>
                        </div>
                        {isPending && <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-[#e8c87f]" />}
                      </div>

                      <div className="space-y-4 p-4 sm:p-5">
                        {error && <p className="rounded-lg bg-[#fce7e6] px-3 py-2 text-sm text-[#8b2d2d]">{error}</p>}

                        {isAvailable && !isScanned && (
                          <div className="player-clue rounded-xl border p-4">
                            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#2f6d67]">Nápověda k místu</p>
                            <p className="mt-2 text-base leading-6 text-[#392d23]">{station.clue || "Nápovědu doplní organizátor."}</p>
                            <button
                              onClick={() => {
                                setScanMessage("Spouštím zadní kameru…");
                                setScannerOpen(true);
                              }}
                              className="mt-4 w-full rounded-lg bg-[#a4332b] px-4 py-3 text-sm font-bold text-white transition hover:bg-[#85271f]"
                            >
                              Naskenovat QR a otevřít úkol
                            </button>
                          </div>
                        )}

                        <div className="player-phases grid grid-cols-4 gap-1.5" aria-label="Fáze stanoviště">
                          {["Najít", "Skenovat", "Splnit", "Schválení"].map((phase, index) => {
                            const currentPhase = isCompleted ? 4 : isPending ? 3 : isScanned ? 2 : 0;
                            const phaseStatus = index < currentPhase ? "done" : index === currentPhase ? "current" : "upcoming";
                            return (
                              <div key={phase} className={`player-phase player-phase-${phaseStatus} rounded-lg px-1.5 py-2 text-center`}>
                                <span className="block text-[9px] font-bold uppercase tracking-wide sm:text-[10px]">{phase}</span>
                              </div>
                            );
                          })}
                        </div>

                        {isAvailable && isScanned && !isCompleted && !isPending && (
                          <div className="rounded-lg bg-[#f8f3eb] px-3 py-2 text-sm leading-5 text-[#665544]">{station.description}</div>
                        )}

                        {isAvailable && isScanned && !isCompleted && !isPending && (
                          <div className="rounded-lg border-l-[3px] border-[#b99152] bg-[#faf6ef] px-3 py-2.5 text-sm font-medium leading-5 text-[#392d23]">
                            {station.task}
                          </div>
                        )}

                        {isPending && (
                          <div className="player-waiting rounded-xl border p-4">
                            <p className="font-semibold text-[#624515]">Úkol je u organizátora</p>
                            <p className="mt-1 text-sm leading-5 text-[#725d3c]">Po schválení se zde zobrazí nápověda k dalšímu stanovišti.</p>
                            {isStoredMediaUrl(latestSubmission?.mediaUrl) && station.type === "photo" && (
                              <Image
                                src={latestSubmission.mediaUrl}
                                alt={`Odevzdaná fotografie – ${station.title}`}
                                width={960}
                                height={640}
                                unoptimized
                                className="mt-3 max-h-64 w-full rounded-lg object-contain"
                              />
                            )}
                            {isStoredMediaUrl(latestSubmission?.mediaUrl) && station.type === "video" && (
                              <video
                                controls
                                preload="metadata"
                                src={latestSubmission.mediaUrl}
                                className="mt-3 max-h-64 w-full rounded-lg bg-black"
                              />
                            )}
                          </div>
                        )}

                        {latestSubmission?.status === "rejected" && isScanned && !isCompleted && (
                          <div className="rounded-lg bg-[#fbe8e4] p-3 text-sm text-[#75392d]">
                            Úkol nebyl schválen. {latestSubmission.comment}
                          </div>
                        )}

                        {!isCompleted && isAvailable && isScanned && !isPending && (
                          <div className="space-y-3">
                          {station.type === "text" && (
                            <textarea
                              value={drafts[station.id] ?? ""}
                              onChange={(event) => setDrafts((current) => ({ ...current, [station.id]: event.target.value }))}
                              placeholder="Napište odpověď..."
                              className="min-h-[96px] w-full rounded-xl border border-[#e3d5c1] bg-[#fcf8f1] p-3 text-sm focus:border-[#ad4434] focus:outline-none focus:ring-2 focus:ring-[#ad4434]/10"
                            />
                          )}

                          {station.type === "number" && (
                            <input
                              type="number"
                              value={drafts[station.id] ?? ""}
                              onChange={(event) => setDrafts((current) => ({ ...current, [station.id]: event.target.value }))}
                              className="w-full rounded-xl border border-[#e3d5c1] bg-[#fcf8f1] p-3 text-sm focus:border-[#ad4434] focus:outline-none focus:ring-2 focus:ring-[#ad4434]/10"
                            />
                          )}

                          {station.type === "photo" && (
                            <div className="space-y-2">
                              <input
                                type="file"
                                accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
                                onChange={(event) => handleFileUpload(station.id, event.target.files?.[0] ?? null)}
                                className="w-full rounded-xl border border-dashed border-[#d7c49a] bg-[#fbf7ef] p-3 text-sm"
                              />
                              {mediaPreviews[station.id] && (
                                <Image
                                  src={mediaPreviews[station.id]}
                                  alt="Náhled vybrané fotografie"
                                  width={960}
                                  height={640}
                                  unoptimized
                                  className="max-h-56 w-full rounded-lg object-contain"
                                />
                              )}
                              {mediaFiles[station.id] && <p className="text-xs text-[#6f5a49]">{mediaFiles[station.id].name} · do 100 MB</p>}
                            </div>
                          )}

                          {station.type === "video" && (
                            <div className="space-y-2">
                              <input
                                type="file"
                                accept="video/mp4,video/webm,video/quicktime"
                                onChange={(event) => handleFileUpload(station.id, event.target.files?.[0] ?? null)}
                                className="w-full rounded-xl border border-dashed border-[#d7c49a] bg-[#fbf7ef] p-3 text-sm"
                              />
                              {mediaPreviews[station.id] && (
                                <video
                                  controls
                                  preload="metadata"
                                  src={mediaPreviews[station.id]}
                                  className="max-h-56 w-full rounded-lg bg-black"
                                />
                              )}
                              {mediaFiles[station.id] && <p className="text-xs text-[#6f5a49]">{mediaFiles[station.id].name} · do 100 MB</p>}
                            </div>
                          )}

                          {station.type === "multiple-choice" && (
                            <div className="space-y-2">
                              {station.options?.map((option) => (
                                <label key={option} className="flex items-center gap-3 rounded-xl border border-[#e3d5c1] bg-[#fcf8f1] p-3 text-sm font-medium text-[#3a3028]">
                                  <input
                                    type="radio"
                                    name={station.id}
                                    checked={drafts[station.id] === option}
                                    onChange={() => setDrafts((current) => ({ ...current, [station.id]: option }))}
                                  />
                                  <span>{option}</span>
                                </label>
                              ))}
                            </div>
                          )}

                          {station.type === "riddle" && (
                            <input
                              value={drafts[station.id] ?? ""}
                              onChange={(event) => setDrafts((current) => ({ ...current, [station.id]: event.target.value }))}
                              placeholder="Zadejte odpověď"
                              className="w-full rounded-xl border border-[#e3d5c1] bg-[#fcf8f1] p-3 text-sm focus:border-[#ad4434] focus:outline-none focus:ring-2 focus:ring-[#ad4434]/10"
                            />
                          )}

                          {station.type === "form" && (
                            <div className="space-y-3">
                              {station.formQuestions?.map((question, questionIndex) => (
                                <div key={question.id} className="rounded-2xl border border-[#e6dcb7] bg-[#fbf7f0] p-3">
                                  <p className="mb-2 text-sm font-semibold text-[#3f3428]"><span className="mr-1.5 text-[#a4332b]">{questionIndex + 1}.</span>{question.label}</p>
                                  {question.type === "text" && (
                                    <input
                                      value={formDrafts[station.id]?.[question.id] ?? ""}
                                      onChange={(event) =>
                                        setFormDrafts((current) => ({
                                          ...current,
                                          [station.id]: {
                                            ...(current[station.id] ?? {}),
                                            [question.id]: event.target.value,
                                          },
                                        }))
                                      }
                                      className="w-full rounded-xl border border-[#d7c7a8] bg-white p-2 text-sm"
                                    />
                                  )}
                                  {question.type === "number" && (
                                    <input
                                      type="number"
                                      value={formDrafts[station.id]?.[question.id] ?? ""}
                                      onChange={(event) =>
                                        setFormDrafts((current) => ({
                                          ...current,
                                          [station.id]: {
                                            ...(current[station.id] ?? {}),
                                            [question.id]: event.target.value,
                                          },
                                        }))
                                      }
                                      className="w-full rounded-xl border border-[#d7c7a8] bg-white p-2 text-sm"
                                    />
                                  )}
                                  {question.type === "multiple-choice" && (
                                    <div className="space-y-2">
                                      {question.options?.map((option) => {
                                        const selected = formDrafts[station.id]?.[question.id] === option;
                                        return (
                                        <label
                                          key={option}
                                          className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm font-medium transition ${selected ? "border-[#a4332b] bg-[#f8e4dc] text-[#6a2b19]" : "border-[#d7c7a8] bg-white text-[#3a3028]"}`}
                                        >
                                          <input
                                            type="radio"
                                            name={`${station.id}-${question.id}`}
                                            className="accent-[#a4332b]"
                                            checked={selected}
                                            onChange={() =>
                                              setFormDrafts((current) => ({
                                                ...current,
                                                [station.id]: {
                                                  ...(current[station.id] ?? {}),
                                                  [question.id]: option,
                                                },
                                              }))
                                            }
                                          />
                                          <span>{option}</span>
                                        </label>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}

                          <button
                            onClick={() => submitTeamAnswer(station)}
                            disabled={submittingStationId === station.id}
                            className="w-full rounded-xl bg-[#a4332b] px-4 py-3.5 text-sm font-bold text-[#fffdf9] shadow-[0_6px_14px_rgba(128,39,31,0.18)] transition hover:bg-[#85271f] disabled:cursor-wait disabled:opacity-70"
                          >
                            {submittingStationId === station.id
                              ? "Nahrávám a odesílám…"
                              : station.requiresApproval ? "Odeslat ke schválení" : "Odevzdat a splnit úkol"}
                          </button>
                        </div>
                      )}

                      {isCompleted && (
                        <div className="rounded-xl bg-[#edf9ec] p-3 text-sm font-medium text-[#245e2f]">
                          Stanoviště bylo úspěšně splněno.
                        </div>
                      )}
                      </div>
                    </div>
                  );
                })()}
              </section>
            </div>

          </div>
        )
      )}

      {screen === "team-dashboard" && teamId && (
        <SupportChat role="team" teamId={teamId} />
      )}

      {screen === "admin-panel" && !isOwnerAdmin && (
        <ManagerConsole
          gameState={gameState}
          wallpaper={wallpaper}
          setWallpaper={setWallpaper}
          onLogout={() => void handleLogout()}
          emergencyDraft={emergencyDraft}
          setEmergencyDraft={setEmergencyDraft}
          emergencyBusy={ownerActionBusy}
          onEmergency={(action) => void handleOwnerAction(action)}
          flashForm={flashMissionForm}
          setFlashForm={setFlashMissionForm}
          onLaunchFlash={launchFlashMission}
          error={error}
          clearError={() => setError("")}
          saving={isSavingGameState}
          saveError={saveError}
        />
      )}

      {screen === "admin-panel" && isOwnerAdmin && (
        <div className="admin-shell admin-console mx-auto max-w-screen-2xl" data-wall={wallpaper}>
          <aside className="admin-sidebar">
            <div className="admin-sidebar-brand">
              <div aria-hidden="true" className="admin-brand-mark">印</div>
              <div>
                <p>Podzimky 2026</p>
                <h1>Správa hry</h1>
              </div>
            </div>
            <div className="admin-sidebar-label">Navigace</div>
            <nav className="admin-sidebar-nav" aria-label="Moduly administrace">
              {([
                { tab: "teams", label: "Týmy", icon: "teams" as const, count: gameState.teams.length },
                { tab: "stations", label: "Stanoviště", icon: "stations" as const, count: gameState.stations.length },
                { tab: "flash", label: "Přepady", icon: "flash" as const, count: gameState.flashMissions.filter((mission) => !mission.archivedAt).length },
                { tab: "submissions", label: "Schvalování", icon: "review" as const, count: pendingSubmissions.length },
                { tab: "support", label: "Podpora", icon: "support" as const, count: 0 },
                ...(isOwnerAdmin ? [{ tab: "media" as const, label: "Galerie", icon: "media" as const, count: mediaSubmissions.length }] : []),
                ...(isOwnerAdmin ? [{ tab: "live" as const, label: "Živý přehled", icon: "live" as const, count: gameState.teams.length }] : []),
                ...(isOwnerAdmin ? [{ tab: "managers" as const, label: "Správci", icon: "teams" as const, count: managers.length }] : []),
              ] as const).map((item) => (
                <button
                  key={item.tab}
                  type="button"
                  aria-current={adminTab === item.tab && isTabOpen(item.tab) ? "page" : undefined}
                  data-open={isDesktop && openTabs.includes(item.tab) ? "true" : undefined}
                  data-dock-tab={item.tab}
                  onClick={() => {
                    setError("");
                    if (isDesktop && adminTab === item.tab && openTabs.includes(item.tab) && !minTabs.includes(item.tab)) {
                      minimizeTab(item.tab);
                      return;
                    }
                    setAdminTab(item.tab);
                    if (item.tab === "managers") void loadManagers();
                    if (item.tab === "teams") void loadTeamQrCards();
                  }}
                >
                  <AdminIcon name={item.icon} />
                  <span>{item.label}</span>
                  {item.tab !== "support" && <span className={classNames("admin-sidebar-count", item.tab === "submissions" && item.count > 0 && "is-alert")}>{item.count}</span>}
                </button>
              ))}
              {isOwnerAdmin && <button
                type="button"
                className="admin-sidebar-presentation"
                onClick={() => {
                  setError("");
                  setAdminTab("media");
                  setGalleryPage(0);
                  if (mediaSubmissions.length > 0) setPresentationIndex(0);
                }}
              >
                <Play size={17} aria-hidden="true" />
                <span>Promítání</span>
              </button>}
            </nav>
            <section className="admin-sidebar-game" aria-label="Ovládání hry">
              {isOwnerAdmin && <div className="admin-sidebar-game-heading">
                <span aria-hidden="true">令</span>
                <div>
                  <p>Stav výpravy</p>
                  <h2>{gameState.gameClosedAt ? "Hra uzavřena" : !gameState.gameStartedAt ? "Čeká na start" : gameState.gameStoppedAt ? "Čas zastaven" : "Hra běží"}</h2>
                </div>
              </div>}
              {!isOwnerAdmin && <p className="admin-sidebar-game-note">Čas hry</p>}
              <ElapsedClock startedAt={gameState.gameStartedAt} stoppedAt={gameState.gameStoppedAt} pausedMs={gameState.gamePausedMs} className="admin-sidebar-clock" />
              {isOwnerAdmin && <p className="admin-sidebar-game-note">
                {gameState.gameStartedAt
                  ? `Spuštěno ${new Date(gameState.gameStartedAt).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}`
                  : "Společný start pro všechny týmy"}
              </p>}
              {isOwnerAdmin && (gameState.gameClosedAt ? (
                <>
                <p className="admin-sidebar-game-note">Hra byla uzavřena a výsledky vyhlášeny.</p>
                <button
                  type="button"
                  onClick={() => void handleGameControl("reopen")}
                  disabled={gameControlBusy}
                  className="admin-sidebar-start"
                >
                  <Play size={15} fill="currentColor" /> {gameControlBusy ? "Spouštím…" : "Znovu spustit hru"}
                </button>
                </>
              ) : !gameState.gameStartedAt ? (
                <button
                  type="button"
                  onClick={() => void handleGameControl("start")}
                  disabled={gameControlBusy || gameState.teams.length === 0}
                  className="admin-sidebar-start"
                >
                  <Play size={15} fill="currentColor" /> {gameControlBusy ? "Spouštím…" : "Odstartovat"}
                </button>
              ) : (
                <>
                <button
                  type="button"
                  onClick={() => void handleGameControl(gameState.gameStoppedAt ? "resume" : "stop")}
                  disabled={gameControlBusy}
                  className="admin-sidebar-restart"
                >
                  {gameState.gameStoppedAt
                    ? <><Play size={15} fill="currentColor" /> Pokračovat</>
                    : <><Pause size={15} /> Pozastavit hru</>}
                </button>
                <button
                  type="button"
                  onClick={() => void handleGameControl("restart")}
                  disabled={gameControlBusy}
                  className="admin-sidebar-restart"
                >
                  <ArrowRight size={15} className="rotate-180" /> {gameControlBusy ? "Restartuji…" : "Restartovat"}
                </button>
                </>
              ))}
              {isOwnerAdmin && error && <p role="alert" className="admin-sidebar-error">{error}</p>}
              {isOwnerAdmin && <div className="admin-sidebar-summary">
                <span>{gameState.teams.length} týmů</span>
                <span>{pendingSubmissions.length} ke schválení</span>
              </div>}
              {isOwnerAdmin && gameState.events[0] && <p className="admin-sidebar-event">{gameState.events[0].message}</p>}
            </section>
            <button
              onClick={() => void handleLogout()}
              className="admin-logout"
            >
              <LogOut size={16} /> Odhlásit
            </button>
          </aside>
          <main className="admin-main">

          <div className="ops-bar" role="status" aria-label="Stav operačního centra">
            <div className="ops-bar-left">
              <div className="ops-bar-id">
                <span className="ops-bar-led" aria-hidden="true" />
                <b>Podzimky OS</b>
                <small>Operační centrum</small>
              </div>
              {isOwnerAdmin && (
                <span className={classNames("ops-chip", gameState.gameStartedAt && !gameState.gameStoppedAt && !gameState.gameClosedAt && "ops-chip-live")}>
                  {gameState.gameClosedAt ? "Hra uzavřena" : gameState.gameStoppedAt ? "Pozastaveno" : gameState.gameStartedAt ? "Výprava běží" : "Čeká na start"}
                </span>
              )}
            </div>
            <div className="ops-bar-center">
              <ElapsedClock startedAt={gameState.gameStartedAt} stoppedAt={gameState.gameStoppedAt} pausedMs={gameState.gamePausedMs} className="ops-bar-clock" />
              <div className="ops-bar-stats">
                <span><i>Týmy</i><b>{gameState.teams.length}</b></span>
                <span><i>Stanoviště</i><b>{gameState.stations.length}</b></span>
                <span><i>Přepady</i><b>{gameState.flashMissions.filter((mission) => !mission.archivedAt).length}</b></span>
                <button
                  type="button"
                  className={classNames(pendingSubmissions.length > 0 && "ops-stat-alert")}
                  onClick={() => { setError(""); setAdminTab("submissions"); }}
                >
                  <i>Ke schválení</i><b>{pendingSubmissions.length}</b>
                </button>
              </div>
            </div>
            <div className="ops-bar-right">
              {gameState.events[0] && <p className="ops-bar-ticker">{gameState.events[0].message}</p>}
              <WallClock className="ops-bar-wall" />
            </div>
            <button type="button" className="ops-search" onClick={() => setPaletteOpen(true)} aria-label="Hledat a spouštět příkazy">Hledat <kbd>Ctrl K</kbd></button>
            <button type="button" className="ops-fs" onClick={toggleFullscreen} title="Celá obrazovka" aria-label="Přepnout celou obrazovku">⛶</button>
          </div>

          {paletteOpen && <CommandPalette
            onClose={() => setPaletteOpen(false)}
            items={[
              { id: "teams", label: "Týmy", hint: "modul · vytvořit tým, QR kartičky", run: () => { setAdminTab("teams"); void loadTeamQrCards(); } },
              { id: "stations", label: "Stanoviště", hint: "modul · úkoly a QR kódy", run: () => setAdminTab("stations") },
              { id: "flash", label: "Přepady", hint: "modul · týmové výzvy", run: () => setAdminTab("flash") },
              { id: "submissions", label: "Schvalování", hint: `modul · ke schválení: ${pendingSubmissions.length}`, run: () => setAdminTab("submissions") },
              { id: "support", label: "Podpora", hint: "modul · chat s týmy", run: () => setAdminTab("support") },
              ...(isOwnerAdmin ? [
                { id: "media", label: "Galerie", hint: "modul · fotky a videa", run: () => setAdminTab("media") },
                { id: "live", label: "Živý přehled", hint: "modul · postup týmů", run: () => setAdminTab("live") },
                { id: "managers", label: "Správci", hint: "modul · správci stanovišť", run: () => { setAdminTab("managers"); void loadManagers(); } },
                { id: "present", label: "Promítání", hint: "příkaz · spustit prezentaci médií", run: () => { setAdminTab("media"); setGalleryPage(0); if (mediaSubmissions.length > 0) setPresentationIndex(0); } },
              ] : []),
              ...WALLPAPERS.map((item) => ({ id: `wall-${item.id}`, label: `Plocha: ${item.label}`, hint: "příkaz · změnit pozadí plochy", run: () => setWallpaper(item.id) })),
              { id: "fullscreen", label: "Celá obrazovka", hint: "příkaz · přepnout fullscreen", run: toggleFullscreen },
              { id: "logout", label: "Odhlásit", hint: "příkaz · ukončit relaci", run: () => void handleLogout() },
            ]}
          />}

          {(saveError || isSavingGameState) && (
            <div role={saveError ? "alert" : "status"} className={classNames(
              "mb-3 flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-xs font-semibold",
              saveError ? "bg-[#fce7e6] text-[#8b2d2d]" : "bg-[#f1eadb] text-[#745b35]",
            )}>
              <span>{saveError || "Ukládám změny…"}</span>
              {saveError && (
                <button onClick={() => setSaveRevision((revision) => revision + 1)} className="shrink-0 underline underline-offset-2">
                  Zkusit znovu
                </button>
              )}
            </div>
          )}

          <div
            className="admin-workspace admin-workspace-module"
            onContextMenu={(event) => {
              if (!isDesktop || (event.target as HTMLElement).closest(".os-win")) return;
              event.preventDefault();
              setDeskMenu({ x: event.clientX, y: event.clientY });
            }}
          >
            {deskMenu && createPortal(
              <div className="os-menu-backdrop" onMouseDown={() => setDeskMenu(null)} onContextMenu={(event) => { event.preventDefault(); setDeskMenu(null); }}>
                <div
                  className="os-menu"
                  role="menu"
                  style={{ left: Math.min(deskMenu.x, window.innerWidth - 220), top: Math.max(8, Math.min(deskMenu.y, window.innerHeight - 470)) }}
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <p>Změnit plochu</p>
                  {WALLPAPERS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={wallpaper === item.id}
                      onClick={() => { setWallpaper(item.id); setDeskMenu(null); }}
                    >
                      <i data-swatch={item.id} aria-hidden="true" />
                      {item.label}
                      {wallpaper === item.id && <b aria-hidden="true">✓</b>}
                    </button>
                  ))}
                </div>
              </div>,
              document.body,
            )}
            {isDesktop && (
              <div className="os-desktop-icons" aria-label="Zástupci na ploše">
                {([
                  { tab: "teams" as const, icon: "teams" as const, count: gameState.teams.length },
                  { tab: "stations" as const, icon: "stations" as const, count: gameState.stations.length },
                  { tab: "flash" as const, icon: "flash" as const, count: gameState.flashMissions.filter((mission) => !mission.archivedAt).length },
                  { tab: "submissions" as const, icon: "review" as const, count: pendingSubmissions.length },
                  { tab: "support" as const, icon: "support" as const, count: 0 },
                  ...(isOwnerAdmin ? [
                    { tab: "media" as const, icon: "media" as const, count: mediaSubmissions.length },
                    { tab: "live" as const, icon: "live" as const, count: gameState.teams.length },
                  ] : []),
                ]).map((item) => (
                  <button
                    key={item.tab}
                    type="button"
                    onClick={() => { setError(""); setAdminTab(item.tab); if (item.tab === "teams") void loadTeamQrCards(); }}
                  >
                    <span className="os-icon-tile">
                      <AdminIcon name={item.icon} />
                      {item.tab === "submissions" && item.count > 0 && <b>{item.count}</b>}
                    </span>
                    <span>{ADMIN_TAB_TITLES[item.tab]}</span>
                  </button>
                ))}
              </div>
            )}
            {isDesktop && openTabs.every((tab) => minTabs.includes(tab)) && (
              <p className="os-desktop-hint"><span aria-hidden="true">印</span>Otevři modul z doku nebo zmáčkni Ctrl+K · pravý klik změní plochu</p>
            )}
            <div className="admin-content min-w-0 space-y-4">
              <header className="module-toolbar">
                <div className="module-toolbar-copy">
                  <p className="admin-eyebrow">{isOwnerAdmin ? "Hlavní pořadatel" : "Správce stanovišť"}</p>
                  <h2>{adminTab === "teams" ? "Týmy" : adminTab === "stations" ? "Stanoviště" : adminTab === "submissions" ? "Schvalování" : adminTab === "media" ? "Galerie" : adminTab === "managers" ? "Správci" : adminTab === "live" ? "Živý přehled" : adminTab === "support" ? "Podpora" : "Přepady"}</h2>
                  <p className="module-toolbar-hint">
                    {adminTab === "teams"
                      ? "Vytvářejte týmy a sdílejte s nimi přihlašovací QR kódy."
                      : adminTab === "stations"
                        ? "Připravte zastávky trasy, jejich úkoly a QR kódy."
                        : adminTab === "submissions"
                          ? "Zkontrolujte odevzdané odpovědi a rozhodněte, zda týmy pokračují."
                          : adminTab === "support"
                            ? "Odpovídejte na dotazy účastníků a komunikujte s jednotlivými týmy."
                          : adminTab === "flash"
                            ? "Vytvářejte týmové výzvy a sledujte jejich plnění."
                            : adminTab === "live"
                              ? "Sledujte postup týmů a stav celé výpravy."
                              : adminTab === "media"
                                ? "Prohlížejte si všechny nahrané důkazy a fotografie."
                                : "Přidejte správce, kteří pomohou s organizací výpravy."}
                  </p>
                </div>
                <span className="module-toolbar-seal" aria-hidden="true">印</span>
                {isOwnerAdmin && <span className={classNames("admin-toolbar-status", gameState.gameStartedAt && "admin-toolbar-status-running")}>
                  <span /> {gameState.gameClosedAt ? "Hra uzavřena" : gameState.gameStoppedAt ? "Hra pozastavena" : gameState.gameStartedAt ? "Výprava probíhá" : "Hra nezačala"}
                </span>}
              </header>

          {isTabOpen("support") && <OsWindow {...winProps("support")}><SupportChat role="admin" canDelete /></OsWindow>}

          {isTabOpen("live") && isOwnerAdmin && (
            <OsWindow {...winProps("live")}>
            <div className="space-y-4">
              <section className="rounded-2xl border border-[#e3d9c9] bg-[#fffdfa] p-5 shadow-[0_8px_22px_rgba(25,19,12,0.05)]">
                <div className="mb-4">
                  <p className="admin-eyebrow">Hlavní admin</p>
                  <h2 className="text-xl font-bold text-[#201c19]">Nouzová zpráva</h2>
                  <p className="mt-1 text-sm text-[#675d53]">Zobrazí se všem přihlášeným týmům a zůstane viditelná do odvolání.</p>
                </div>
                {gameState.emergencyMessage && (
                  <p className="mb-3 whitespace-pre-wrap rounded-xl border border-[#dc9c77] bg-[#fff0e8] p-3 text-sm text-[#78351e]">
                    Aktivní zpráva: {gameState.emergencyMessage.message}
                  </p>
                )}
                <textarea
                  value={emergencyDraft}
                  onChange={(event) => setEmergencyDraft(event.target.value)}
                  maxLength={500}
                  rows={3}
                  disabled={Boolean(gameState.gameClosedAt) || ownerActionBusy}
                  placeholder="Například: Přerušte hru a dostavte se k hlavnímu stanu."
                  className="w-full rounded-xl border border-[#d8c6a2] bg-white p-3 text-sm text-[#30251e] outline-none focus:ring-2 focus:ring-[#d59a39]/30 disabled:opacity-60"
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void handleOwnerAction({ action: "emergency-message", message: emergencyDraft })}
                    disabled={Boolean(gameState.gameClosedAt) || ownerActionBusy || !emergencyDraft.trim()}
                    className="admin-primary-button disabled:opacity-50"
                  >
                    <AlertTriangle size={16} /> Odeslat všem týmům
                  </button>
                  {gameState.emergencyMessage && (
                    <button
                      type="button"
                      onClick={() => void handleOwnerAction({ action: "clear-emergency-message" })}
                      disabled={Boolean(gameState.gameClosedAt) || ownerActionBusy}
                      className="rounded-xl border border-[#d8c6a2] bg-white px-4 py-2 text-sm font-semibold text-[#553d2d] disabled:opacity-50"
                    >
                      Odvolat zprávu
                    </button>
                  )}
                </div>
              </section>

              <section className="rounded-2xl border border-[#e3d9c9] bg-[#fffdfa] p-5 shadow-[0_8px_22px_rgba(25,19,12,0.05)]">
                <p className="admin-eyebrow">Hlavní admin</p>
                <h2 className="text-xl font-bold text-[#201c19]">Ruční zásah do postupu</h2>
                <p className="mt-1 text-sm text-[#675d53]">Vrácením kroku se zruší splnění i skeny tohoto a následujících stanovišť.</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="text-sm font-semibold text-[#483b2e]">
                    Tým
                    <select
                      value={manualTeamId}
                      onChange={(event) => setManualTeamId(event.target.value)}
                      disabled={Boolean(gameState.gameClosedAt) || ownerActionBusy}
                      className="mt-1 w-full rounded-xl border border-[#d8c6a2] bg-white p-3"
                    >
                      <option value="">Vyberte tým</option>
                      {gameState.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                    </select>
                  </label>
                  <label className="text-sm font-semibold text-[#483b2e]">
                    Stanoviště
                    <select
                      value={manualStationId}
                      onChange={(event) => setManualStationId(event.target.value)}
                      disabled={Boolean(gameState.gameClosedAt) || ownerActionBusy}
                      className="mt-1 w-full rounded-xl border border-[#d8c6a2] bg-white p-3"
                    >
                      <option value="">Vyberte stanoviště</option>
                      {[...gameState.stations].sort((first, second) => first.order - second.order).map((station) => (
                        <option key={station.id} value={station.id}>{station.order}. {station.title}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void handleOwnerAction({ action: "intervene", teamId: manualTeamId, stationId: manualStationId, completed: true })}
                    disabled={Boolean(gameState.gameClosedAt) || ownerActionBusy || !manualTeamId || !manualStationId}
                    className="admin-primary-button disabled:opacity-50"
                  >
                    Ručně splnit stanoviště
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleOwnerAction({ action: "intervene", teamId: manualTeamId, stationId: manualStationId, completed: false })}
                    disabled={Boolean(gameState.gameClosedAt) || ownerActionBusy || !manualTeamId || !manualStationId}
                    className="rounded-xl border border-[#d8c6a2] bg-white px-4 py-2 text-sm font-semibold text-[#553d2d] disabled:opacity-50"
                  >
                    Vrátit tento krok
                  </button>
                </div>
              </section>

              <section className="rounded-2xl border border-[#e3d9c9] bg-[#fffdfa] p-5 shadow-[0_8px_22px_rgba(25,19,12,0.05)]">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="admin-eyebrow">Aktualizuje se automaticky</p>
                    <h2 className="text-xl font-bold text-[#201c19]">Živý přehled hry</h2>
                  </div>
                  <span className="text-sm text-[#675d53]">{gameState.teams.length} týmů · {pendingSubmissions.length} čeká na schválení</span>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {gameState.teams.map((team) => {
                    const completed = team.completedStations.length;
                    const nextStation = [...gameState.stations]
                      .sort((first, second) => first.order - second.order)
                      .find((station) => !team.completedStations.includes(station.id));
                    const pendingCount = pendingSubmissions.filter((submission) => submission.teamId === team.id).length;
                    const scannedNext = nextStation && team.scannedStationIds.includes(nextStation.id);
                    const status = !gameState.gameStartedAt
                      ? "Čeká na start"
                      : team.flashMissionId
                        ? "Řeší přepad"
                        : pendingCount
                          ? "Čeká na schválení"
                          : !nextStation
                            ? "Dokončeno"
                            : scannedNext
                              ? `Na stanovišti: ${nextStation.title}`
                              : "Na trase";
                    return (
                      <article key={team.id} className="rounded-xl border border-[#e8ddc9] bg-white p-4">
                        <div className="flex items-start justify-between gap-3">
                          <h3 className="font-bold text-[#30251e]">{team.name}</h3>
                          <span className="rounded-full bg-[#f5eddd] px-2.5 py-1 text-xs font-semibold text-[#72501f]">{status}</span>
                        </div>
                        <p className="mt-2 text-sm text-[#675d53]">{completed} / {gameState.stations.length} stanovišť splněno</p>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#efe6d4]">
                          <div className="h-full bg-[#7d4d19]" style={{ width: `${Math.min((completed / Math.max(gameState.stations.length, 1)) * 100, 100)}%` }} />
                        </div>
                      </article>
                    );
                  })}
                  {gameState.teams.length === 0 && <p className="text-sm text-[#675d53]">Zatím nebyly vytvořeny žádné týmy.</p>}
                </div>
                <h3 className="mb-2 mt-6 font-bold text-[#30251e]">Poslední události</h3>
                <ul className="space-y-2">
                  {gameState.events.slice(0, 8).map((event) => (
                    <li key={event.id} className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-[#eee5d6] pt-2 text-sm">
                      <span className="text-[#483b2e]">{event.message}</span>
                      <time className="text-xs text-[#8a7a68]" dateTime={event.createdAt}>
                        {new Date(event.createdAt).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}
                      </time>
                    </li>
                  ))}
                  {gameState.events.length === 0 && <li className="text-sm text-[#675d53]">Zatím bez událostí.</li>}
                </ul>
              </section>

              <section className="rounded-2xl border border-[#d5a24a] bg-[#fff5df] p-5 shadow-[0_8px_22px_rgba(25,19,12,0.05)]">
                <h2 className="text-xl font-bold text-[#39291d]">{gameState.gameClosedAt ? "Hra je uzavřená" : "Uzavření hry a vyhlášení výsledků"}</h2>
                <p className="mt-1 text-sm text-[#72501f]">
                  {gameState.gameClosedAt
                    ? "Výsledky jsou zveřejněné týmům a další herní změny jsou zablokované."
                    : "Po uzavření se týmy už nemohou účastnit. Pořadí určuje počet splněných stanovišť; při shodě týmy sdílejí umístění."}
                </p>
                {!gameState.gameClosedAt && (
                  <button
                    type="button"
                    onClick={() => void handleOwnerAction({ action: "close-game" })}
                    disabled={!gameState.gameStartedAt || ownerActionBusy}
                    className="mt-4 rounded-xl bg-[#8e3026] px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
                  >
                    Uzavřít hru a vyhlásit výsledky
                  </button>
                )}
                {gameState.gameClosedAt && (
                  <ol className="mt-4 space-y-2">
                    {(gameState.gameResults ?? []).map((result) => (
                      <li key={result.teamId} className="flex justify-between rounded-xl border border-[#e7d7b4] bg-white/70 px-4 py-3 text-sm">
                        <span className="font-bold">{result.rank}. {result.teamName}</span>
                        <span>{result.completedStations} stanovišť</span>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
              {error && <p role="alert" className="rounded-xl bg-[#fce7e6] p-3 text-sm font-semibold text-[#8b2d2d]">{error}</p>}
            </div>
            </OsWindow>
          )}

          {isTabOpen("teams") && (
            <OsWindow {...winProps("teams")}>
            <>
            <section className="rounded-2xl border border-[#e3d9c9] bg-[#fffdfa] p-5 shadow-[0_8px_22px_rgba(25,19,12,0.05)]">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="admin-eyebrow">Správa výpravy</p>
                  <h2 className="text-2xl font-bold text-[#201c19]">Týmy</h2>
                  <p className="mt-1 text-sm text-[#675d53]">{gameState.teams.length} týmů</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setError("");
                    setTeamFormAdmin({ name: "", password: "", qrCardId: "" });
                    setIsTeamDialogOpen(true);
                  }}
                  className="admin-primary-button"
                >
                  <Plus size={17} /> Přidat tým
                </button>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {visibleTeams.map((team) => {
                  const completed = team.completedStations.length;
                  const percent = Math.round((completed / Math.max(gameState.stations.length, 1)) * 100);
                  const teamPending = gameState.submissions.filter(
                    (submission) => submission.teamId === team.id && submission.status === "pending" && !submission.archivedAt,
                  ).length;
                  const teamStatus = !gameState.gameStartedAt
                    ? "Čeká na společný start"
                    : team.flashMissionId
                      ? "Přepadová výzva"
                      : teamPending > 0
                        ? "Čeká na schválení"
                        : completed >= gameState.stations.length && gameState.stations.length > 0
                          ? "V cíli"
                          : completed > 0
                            ? "Na trase"
                            : "Připraven";
                  return (
                    <article key={team.id} className="admin-team-card">
                      <div className="admin-team-list-row">
                        <div className="min-w-0">
                          <h3>{team.name}</h3>
                          <p><span className="team-status-dot" />{teamStatus}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleRemoveTeam(team)}
                          disabled={deletingTeamId === team.id}
                          aria-label={`Odstranit tým ${team.name}`}
                          title="Odstranit tým"
                          className="admin-danger-button"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                      <details className="admin-team-details">
                        <summary>Podrobnosti <span>{completed} / {gameState.stations.length} zastávek</span></summary>
                        <div className="admin-team-details-body">
                      <div className="team-detail-time">
                        <span>Čas výpravy</span><ElapsedClock startedAt={gameState.gameStartedAt} stoppedAt={gameState.gameStoppedAt} pausedMs={gameState.gamePausedMs} />
                      </div>
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#efe6d4]">
                        <div className="h-full rounded-full bg-[#7d4d19]" style={{ width: `${percent}%` }} />
                      </div>
                      <p className="mt-3 text-xs text-[#675d53]">
                        {teamPending > 0 ? `${teamPending} úkol čeká na schválení` : team.flashMissionId ? "Má aktivní přepad" : "Bez čekajících úkolů"}
                      </p>
                      {(() => {
                        const teamCard = teamQrCards.find((card) => card.teamId === team.id);
                        if (teamCard) {
                          return (
                            <div className="mt-3 flex items-start gap-3 rounded-lg border border-[#e5d9c7] bg-white p-3">
                              <TeamCardQr
                                cardId={teamCard.id}
                                size={112}
                                label={`Přihlašovací QR kód týmu ${team.name}`}
                                fileName={`tymova-karticka-${team.id}.svg`}
                              />
                              <p className="max-w-48 text-xs leading-relaxed text-[#675d53]">
                                Přihlašovací QR kartička týmu. Uchovávejte ji bezpečně.
                              </p>
                            </div>
                          );
                        }
                        return null;
                      })()}
                      {!teamQrCards.some((card) => card.teamId === team.id) && generatedTeamQr?.teamId === team.id && (
                        <div className="mt-3 flex items-center gap-3 rounded-lg border border-[#e5d9c7] bg-white p-3">
                          <QRCodeSVG
                            value={generatedTeamQr.value}
                            size={112}
                            level="Q"
                            marginSize={3}
                            title={`Přihlašovací QR kód týmu ${team.name}`}
                            data-qr-uid={generatedTeamQr.value}
                          />
                          <div className="max-w-48">
                            <p className="text-xs leading-relaxed text-[#675d53]">
                              Tento kód umožní přihlášení k týmu. Uchovávejte ho bezpečně.
                            </p>
                            <button
                              type="button"
                              onClick={() => {
                                if (!downloadQrSvg(generatedTeamQr.value, `prihlaseni-${team.id}.svg`)) {
                                  setError("Přihlašovací QR kód se nepodařilo připravit ke stažení.");
                                }
                              }}
                              className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[#312d27] px-3 py-2 text-xs font-bold text-white"
                            >
                              <Download size={14} /> Stáhnout QR
                            </button>
                          </div>
                        </div>
                      )}
                        </div>
                      </details>
                    </article>
                  );
                })}
                {gameState.teams.length === 0 && (
                  <p className="rounded-xl border border-dashed border-[#d9d0c2] p-5 text-sm text-[#716d63] md:col-span-2">
                    Zatím tu nejsou žádné týmy. Vytvořte první tým.
                  </p>
                )}
              </div>
              <section className="mt-6 rounded-2xl border border-[#e3d9c9] bg-[#fffaf1] p-5 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-bold text-[#201c19]">Sklad QR kartiček</h3>
                    <p className="mt-1 max-w-2xl text-sm text-[#675d53]">
                      Volné kartičky k vytištění před akcí. Po přiřazení týmu zmizí odsud a najdete je v jeho podrobnostech.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleCreateTeamQrCard()}
                    disabled={isCreatingTeamQrCard}
                    className="admin-secondary-button"
                  >
                    <Plus size={16} /> {isCreatingTeamQrCard ? "Vytvářím…" : "Vytvořit QR kartičku"}
                  </button>
                </div>
                {error && <p role="alert" className="mt-3 rounded-xl bg-[#fce7e6] p-3 text-sm font-semibold text-[#8b2d2d]">{error}</p>}
                {teamQrCards.some((card) => card.teamId === null) ? (
                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {teamQrCards.filter((card) => card.teamId === null).map((card) => {
                      const label = `Kartička ${card.id.slice(0, 8).toUpperCase()}`;
                      return (
                        <article key={card.id} className="flex flex-col items-center gap-3 rounded-xl border border-[#e3d9c9] bg-white p-4">
                          <TeamCardQr
                            centered
                            cardId={card.id}
                            size={120}
                            label={`Přihlašovací QR ${label}`}
                            fileName={`tymova-karticka-${card.id.slice(0, 8)}.svg`}
                          />
                          <p className="text-sm font-bold tracking-wide text-[#201c19]">{label}</p>
                          <button
                            type="button"
                            onClick={() => void handleRemoveTeamQrCard(card.id)}
                            className="inline-flex w-full items-center justify-center gap-1 rounded-lg border border-[#d8c6a2] px-2.5 py-1.5 text-xs font-bold text-[#6a2b19]"
                          >
                            <Trash2 size={13} /> Odebrat
                          </button>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-4 rounded-xl border border-dashed border-[#d9d0c2] p-4 text-center text-sm text-[#675d53]">Ve skladu nejsou žádné volné QR kartičky.</p>
                )}
              </section>
              {teamPageCount > 1 && (
                <div className="admin-pagination">
                  <span>{teamPage * managementPageSize + 1}–{Math.min((teamPage + 1) * managementPageSize, gameState.teams.length)} z {gameState.teams.length}</span>
                  <div>
                    <button type="button" onClick={() => setTeamPage((page) => Math.max(0, page - 1))} disabled={teamPage === 0}>Předchozí</button>
                    <button type="button" onClick={() => setTeamPage((page) => Math.min(teamPageCount - 1, page + 1))} disabled={teamPage + 1 >= teamPageCount}>Další</button>
                  </div>
                </div>
              )}
            </section>
            {isTeamDialogOpen && (
              <AdminDialog
                title={createdTeamQr ? `Tým ${createdTeamQr.name} vytvořen` : "Nový tým"}
                description={createdTeamQr
                  ? "Tým se může přihlásit heslem, nebo naskenováním tohoto QR kódu. Fungují oba způsoby."
                  : "Zvolte název a heslo, nebo přiřaďte QR kartičku připravenou před akcí."}
                onClose={() => { setIsTeamDialogOpen(false); setCreatedTeamQr(null); }}
                variant="drawer"
              >
                {createdTeamQr ? (
                <div className="admin-dialog-body">
                  <div className="flex flex-col items-center gap-3 rounded-xl border border-[#e5d9c7] bg-white p-4">
                    <QRCodeSVG
                      value={createdTeamQr.value}
                      size={200}
                      level="Q"
                      marginSize={3}
                      title={`Přihlašovací QR kód týmu ${createdTeamQr.name}`}
                      data-qr-uid={createdTeamQr.value}
                    />
                    <p className="text-center text-xs text-[#675d53]">Uchovávejte kód bezpečně. Kdokoli s ním se může za tým přihlásit.</p>
                    <button
                      type="button"
                      onClick={() => {
                        if (!downloadQrSvg(createdTeamQr.value, `prihlaseni-${createdTeamQr.teamId}.svg`)) {
                          setError("Přihlašovací QR kód se nepodařilo připravit ke stažení.");
                        }
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#312d27] px-3 py-2 text-xs font-bold text-white"
                    >
                      <Download size={14} /> Stáhnout QR
                    </button>
                  </div>
                  {error && <p role="alert" className="rounded-xl bg-[#fce7e6] p-3 text-sm font-semibold text-[#8b2d2d]">{error}</p>}
                  <div className="admin-dialog-actions">
                    <button type="button" onClick={() => { setIsTeamDialogOpen(false); setCreatedTeamQr(null); }} className="admin-primary-button">Hotovo</button>
                  </div>
                </div>
                ) : (
                <div className="admin-dialog-body">
                  <label className="admin-field-label">
                    Název týmu
                    <input
                      autoFocus
                      value={teamFormAdmin.name}
                      onChange={(event) => setTeamFormAdmin((current) => ({ ...current, name: event.target.value }))}
                      placeholder="Například: Dračí stráž"
                      maxLength={80}
                      className="w-full rounded-xl border p-3 text-sm"
                    />
                  </label>
                  <label className="admin-field-label mt-4">
                    Heslo pro hráče
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={teamFormAdmin.password}
                      onChange={(event) => setTeamFormAdmin((current) => ({ ...current, password: event.target.value }))}
                      placeholder={teamFormAdmin.qrCardId ? "Volitelné při přiřazení QR kartičky" : "Alespoň 8 znaků"}
                      className="w-full rounded-xl border p-3 text-sm"
                    />
                  </label>
                  <label className="admin-field-label mt-4">
                    Předem vytištěná QR kartička (volitelné)
                    <select
                      value={teamFormAdmin.qrCardId}
                      onChange={(event) => setTeamFormAdmin((current) => ({ ...current, qrCardId: event.target.value }))}
                      className="w-full rounded-xl border p-3 text-sm"
                    >
                      <option value="">Vytvořit běžný týmový QR</option>
                      {teamQrCards.map((card) => card.teamId === null && (
                        <option key={card.id} value={card.id}>Kartička {card.id.slice(0, 8).toUpperCase()}</option>
                      ))}
                    </select>
                    <span className="text-xs font-normal text-[#675d53]">
                      Přiřazením se dříve vytištěný QR začne přihlašovat k tomuto týmu.
                    </span>
                  </label>
                  {error && <p role="alert" className="mt-4 rounded-xl bg-[#fce7e6] px-3 py-2 text-sm text-[#8b2d2d]">{error}</p>}
                  <div className="admin-dialog-actions">
                    <button type="button" onClick={() => setIsTeamDialogOpen(false)} className="admin-secondary-button">Zrušit</button>
                    <button type="button" onClick={() => void handleAddTeam()} disabled={isCreatingTeam} className="admin-primary-button">{isCreatingTeam ? "Vytvářím…" : "Vytvořit tým"}</button>
                  </div>
                </div>
                )}
              </AdminDialog>
            )}
            </>
            </OsWindow>
          )}

          {isTabOpen("stations") && (
            <OsWindow {...winProps("stations")}>
            <>
            <section className="rounded-[24px] bg-[#fffdfa] p-3 shadow-[0_12px_30px_rgba(20,16,14,0.08)]">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 px-1">
                <div>
                  <p className="admin-eyebrow">Trasa výpravy</p>
                  <h2 className="text-xl font-bold text-[#201c19]">Stanoviště</h2>
                  <p className="mt-1 text-sm text-[#675d53]">{gameState.stations.length} míst · pořadí řídí trasu</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setError("");
                    setStationFormStep(0);
                    setEditingStationId(null);
                    setAdminStationForm((current) => ({
                      ...current,
                      uid: createUniqueStationUid(gameState.stations),
                    }));
                    setIsStationDialogOpen(true);
                  }}
                  className="admin-primary-button"
                >
                  <Plus size={17} /> Přidat stanoviště
                </button>
              </div>

              <div className="space-y-2">
                {visibleStations.map((station) => (
                  <div key={station.id} className="rounded-lg border border-[#e1d4b6] bg-[#faf6ef] px-3 py-2.5">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#f1e4cf] text-xs font-bold text-[#8f3529]">{station.order}</span>
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-bold text-[#201c19]">{station.title}</h3>
                          <p className="font-mono text-xs text-[#756958]">{station.uid}</p>
                          {station.isDraft && <p className="text-xs font-semibold text-[#9a4b22]">QR připraveno · doplňte název a úkol</p>}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                        <button
                          onClick={() => setVisibleStationQr((current) => current === station.id ? null : station.id)}
                          className="rounded-md border border-[#d4c3a2] bg-white px-2.5 py-1.5 text-xs font-bold text-[#4d3b2a]"
                          aria-expanded={visibleStationQr === station.id}
                        >
                          {visibleStationQr === station.id ? "Skrýt QR" : "QR kód"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setError("");
                            setStationFormStep(0);
                            setEditingStationId(station.id);
                            setAdminStationForm({
                              title: station.title,
                              description: station.description,
                              clue: station.clue,
                              task: station.task,
                              uid: station.uid,
                              type: station.type,
                              instructions: station.instructions ?? "",
                              requiresApproval: station.requiresApproval,
                              answer: station.answer ?? "",
                              optionsText: station.options?.join("\n") ?? "",
                              formQuestions: station.formQuestions ?? [],
                              questionDraft: { label: "", type: "text", optionsText: "", answer: "" },
                            });
                            setIsStationDialogOpen(true);
                          }}
                          className="rounded-md border border-[#d4c3a2] bg-white px-2.5 py-1.5 text-xs font-bold text-[#4d3b2a]"
                        >
                          {station.isDraft ? "Doplnit" : "Upravit"}
                        </button>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={station.requiresApproval}
                          aria-label={`Schvalování úkolu stanoviště ${station.title}`}
                          onClick={() => setGameState((previous) => ({
                            ...previous,
                            stations: previous.stations.map((item) =>
                              item.id === station.id ? { ...item, requiresApproval: !item.requiresApproval } : item,
                            ),
                          }))}
                          className={classNames(
                            "rounded-md px-2.5 py-1.5 text-xs font-bold",
                            station.requiresApproval ? "bg-[#e9e8fb] text-[#484176]" : "bg-[#e2f3e8] text-[#27603f]",
                          )}
                        >
                          {station.requiresApproval ? "Schvaluje pořadatel" : "Automatické splnění"}
                        </button>
                        <button onClick={() => moveStation(station.id, "up")} aria-label={`Posunout ${station.title} nahoru`} className="rounded-md bg-[#efe3cb] px-2.5 py-1.5 text-xs font-bold">↑</button>
                        <button onClick={() => moveStation(station.id, "down")} aria-label={`Posunout ${station.title} dolů`} className="rounded-md bg-[#efe3cb] px-2.5 py-1.5 text-xs font-bold">↓</button>
                        <button onClick={() => removeStation(station.id)} aria-label={`Odstranit ${station.title}`} className="rounded-md bg-[#efdfd7] px-2.5 py-1.5 text-xs font-bold text-[#6a2b19]">Odebrat</button>
                      </div>
                    </div>
                    <details className="mt-2 border-t border-[#e8dccb] pt-1.5">
                      <summary className="cursor-pointer text-xs font-semibold text-[#8f3529]">Popis a nápověda</summary>
                      <p className="mt-2 text-sm text-[#514740]">{station.description}</p>
                      <p className="mt-1 text-sm text-[#72501f]"><span className="font-semibold">Nápověda:</span> {station.clue || "—"}</p>
                    </details>
                    {visibleStationQr === station.id && (
                      <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-[#e1d4b6] pt-4">
                        <div className="rounded-lg bg-white p-3">
                          <QRCodeSVG value={station.uid} size={164} level="M" marginSize={4} title={`QR kód stanoviště ${station.order}`} data-qr-uid={station.uid} />
                        </div>
                        <div>
                          <p className="font-semibold text-[#201c19]">Naskenujte na stanovišti</p>
                          <p className="mt-1 font-mono text-lg tracking-widest text-[#72501f]">{station.uid}</p>
                          <button
                            onClick={() => {
                              if (!downloadQrSvg(station.uid, `stanoviste-${station.uid}.svg`)) {
                                setError("QR kód se nepodařilo připravit ke stažení.");
                              }
                            }}
                            className="mt-3 rounded-lg border border-[#d4c3a2] bg-white px-3 py-2 text-sm font-semibold text-[#4d3b2a]"
                          >
                            Stáhnout QR
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                {gameState.stations.length === 0 && (
                  <p className="rounded-xl border border-dashed border-[#d9d0c2] p-5 text-sm text-[#716d63]">Trasa zatím nemá stanoviště. Přidejte první místo.</p>
                )}
              </div>
              {stationPageCount > 1 && (
                <div className="admin-pagination">
                  <span>{stationPage * managementPageSize + 1}–{Math.min((stationPage + 1) * managementPageSize, gameState.stations.length)} z {gameState.stations.length}</span>
                  <div>
                    <button type="button" onClick={() => setStationPage((page) => Math.max(0, page - 1))} disabled={stationPage === 0}>Předchozí</button>
                    <button type="button" onClick={() => setStationPage((page) => Math.min(stationPageCount - 1, page + 1))} disabled={stationPage + 1 >= stationPageCount}>Další</button>
                  </div>
                </div>
              )}

            </section>
            {isStationDialogOpen && (
              <AdminDialog
                title={editingStationId ? "Upravit stanoviště" : "Nové stanoviště"}
                description={editingStationId
                  ? "Upravte podrobnosti. UID ani vytištěný QR kód se nezmění."
                  : "UID i QR kód se vytvoří automaticky. Zadání můžete doplnit později."}
                onClose={() => { setIsStationDialogOpen(false); setEditingStationId(null); }}
                variant="drawer"
              >
                <div className="admin-dialog-body">
                  <div className="admin-stepper" aria-label="Kroky nového stanoviště">
                    {["Základ", "Další nastavení"].map((label, index) => (
                      <button
                        key={label}
                        type="button"
                        aria-current={stationFormStep === index ? "step" : undefined}
                        onClick={() => setStationFormStep(index as 0 | 1)}
                      >
                        <span>{index + 1}</span>{label}
                      </button>
                    ))}
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                  <div className="contents" style={{ display: stationFormStep === 0 ? "contents" : "none" }}>
                  <label className="admin-field-label">
                    Název stanoviště
                    <input
                      value={adminStationForm.title}
                      onChange={(event) => setAdminStationForm((current) => ({ ...current, title: event.target.value }))}
                      placeholder="Například: Starý most"
                      maxLength={100}
                      className="rounded-xl border border-[#d8c6a2] bg-white p-3 text-sm"
                    />
                  </label>
                  <label className="admin-field-label md:col-span-2">
                    Zadání úkolu
                    <textarea
                      value={adminStationForm.task}
                      onChange={(event) => setAdminStationForm((current) => ({ ...current, task: event.target.value }))}
                      placeholder="Co mají hráči udělat nebo objevit?"
                      rows={3}
                      className="rounded-xl border border-[#d8c6a2] bg-white p-3 text-sm"
                    />
                  </label>
                  <label className="admin-field-label md:col-span-2">
                    Jak hráči úkol odevzdají?
                    <select
                      value={adminStationForm.type}
                      onChange={(event) => setAdminStationForm((current) => ({ ...current, type: event.target.value as StationType }))}
                      className="rounded-xl border border-[#d8c6a2] bg-white p-3 text-sm"
                    >
                      <option value="text">Textová odpověď</option>
                      <option value="number">Číselná odpověď</option>
                      <option value="photo">Fotografie</option>
                      <option value="video">Video</option>
                      <option value="multiple-choice">Výběr odpovědi</option>
                      <option value="riddle">Hádanka</option>
                      <option value="form">Formulář</option>
                    </select>
                  </label>
                  <div className="station-qr-preview md:col-span-2">
                    <div className="station-qr-preview-code">
                      <QRCodeSVG
                        value={adminStationForm.uid}
                        size={128}
                        level="M"
                        marginSize={4}
                        title={`Automaticky vytvořený QR kód stanoviště ${adminStationForm.uid}`}
                        data-qr-uid={adminStationForm.uid}
                      />
                    </div>
                    <div>
                      <p className="station-qr-preview-label">Připravené UID a QR</p>
                      <p className="station-qr-preview-uid">{adminStationForm.uid}</p>
                      <p className="station-qr-preview-hint">Kód se automaticky uloží ke stanovišti. QR můžete stáhnout nebo vytisknout.</p>
                      <button
                        type="button"
                        onClick={() => {
                          if (!downloadQrSvg(adminStationForm.uid, `stanoviste-${adminStationForm.uid}.svg`)) {
                            setError("QR kód se nepodařilo připravit ke stažení.");
                          }
                        }}
                        className="station-qr-preview-download"
                      >
                        <Download size={14} /> Stáhnout QR
                      </button>
                    </div>
                  </div>
                  <details className="station-advanced-settings md:col-span-2">
                    <summary>Nápověda a pravidla</summary>
                  <label className="admin-field-label md:col-span-2">
                    Krátký popis místa
                    <input
                      value={adminStationForm.description}
                      onChange={(event) => setAdminStationForm((current) => ({ ...current, description: event.target.value }))}
                      placeholder="Co hráči po příchodu uvidí?"
                      className="rounded-xl border border-[#d8c6a2] bg-white p-3 text-sm"
                    />
                  </label>
                  <label className="admin-field-label md:col-span-2">
                    Nápověda k nalezení
                    <textarea
                      value={adminStationForm.clue}
                      onChange={(event) => setAdminStationForm((current) => ({ ...current, clue: event.target.value }))}
                      placeholder="Napište nápovědu, která hráče dovede na místo."
                      rows={2}
                      className="rounded-xl border border-[#d8c6a2] bg-white p-3 text-sm"
                    />
                  </label>
                  </details>
                  </div>
                  <div className="contents" style={{ display: stationFormStep === 1 ? "contents" : "none" }}>
                  {adminStationForm.type === "multiple-choice" && (
                    <>
                      <label className="admin-field-label md:col-span-2">
                        Možnosti odpovědi
                        <textarea
                          value={adminStationForm.optionsText}
                          onChange={(event) => setAdminStationForm((current) => ({ ...current, optionsText: event.target.value }))}
                          placeholder={"Každou možnost napište na samostatný řádek"}
                          rows={4}
                          className="w-full rounded-xl border border-[#d8c6a2] bg-white p-3 text-sm"
                        />
                      </label>
                      <label className="admin-field-label md:col-span-2">
                        Správná odpověď (volitelné při ručním schválení)
                        <input
                          value={adminStationForm.answer}
                          onChange={(event) => setAdminStationForm((current) => ({ ...current, answer: event.target.value }))}
                          placeholder="Musí přesně odpovídat jedné možnosti"
                          className="w-full rounded-xl border border-[#d8c6a2] bg-white p-3 text-sm"
                        />
                      </label>
                    </>
                  )}
                  {!["photo", "video", "multiple-choice", "form"].includes(adminStationForm.type) && (
                    <label className="admin-field-label md:col-span-2">
                      Správná odpověď
                      <input
                        value={adminStationForm.answer}
                        onChange={(event) => setAdminStationForm((current) => ({ ...current, answer: event.target.value }))}
                        placeholder={adminStationForm.requiresApproval ? "Volitelné — server bude odpověď kontrolovat" : "Povinné při automatickém splnění"}
                        className="w-full rounded-xl border border-[#d8c6a2] bg-white p-3 text-sm"
                      />
                    </label>
                  )}
                  {adminStationForm.type === "form" && (
                    <div className="space-y-3 rounded-xl border border-[#e1d4b6] bg-[#fffaf1] p-3 md:col-span-2">
                      <p className="text-sm font-bold text-[#4d3b2a]">Otázky formuláře</p>
                      {adminStationForm.formQuestions.map((question, questionIndex, allQuestions) => (
                        <div key={question.id} className="flex items-center justify-between gap-3 rounded-lg bg-white p-3 text-sm">
                          <span className="min-w-0">
                            <span className="block font-semibold text-[#342b23]">{questionIndex + 1}. {question.label}</span>
                            <span className="text-xs text-[#756958]">{question.type === "multiple-choice" ? question.options?.join(" · ") : question.type === "number" ? "Číselná odpověď" : "Textová odpověď"}{question.answer ? ` · správně: ${question.answer}` : ""}</span>
                          </span>
                          <span className="flex shrink-0 gap-1">
                            {([-1, 1] as const).map((direction) => (
                              <button
                                key={direction}
                                type="button"
                                aria-label={direction < 0 ? "Posunout nahoru" : "Posunout dolů"}
                                disabled={direction < 0 ? questionIndex === 0 : questionIndex === allQuestions.length - 1}
                                onClick={() => setAdminStationForm((current) => {
                                  const next = [...current.formQuestions];
                                  [next[questionIndex], next[questionIndex + direction]] = [next[questionIndex + direction], next[questionIndex]];
                                  return { ...current, formQuestions: next };
                                })}
                                className="rounded-lg bg-[#f4e5c5] px-2.5 py-2 text-xs font-bold text-[#5a3c18] disabled:opacity-40"
                              >
                                {direction < 0 ? "↑" : "↓"}
                              </button>
                            ))}
                          <button
                            type="button"
                            onClick={() => setAdminStationForm((current) => ({
                              ...current,
                              formQuestions: current.formQuestions.filter((item) => item.id !== question.id),
                            }))}
                            className="shrink-0 rounded-lg bg-[#efdfd7] px-3 py-2 text-xs font-bold text-[#6a2b19]"
                          >
                            Odebrat
                          </button>
                          </span>
                        </div>
                      ))}
                      <div className="grid gap-2 sm:grid-cols-2">
                        <input
                          value={adminStationForm.questionDraft.label}
                          onChange={(event) => setAdminStationForm((current) => ({
                            ...current,
                            questionDraft: { ...current.questionDraft, label: event.target.value },
                          }))}
                          placeholder="Znění otázky"
                          className="rounded-xl border border-[#d8c6a2] bg-white p-3 text-sm"
                        />
                        <select
                          value={adminStationForm.questionDraft.type}
                          onChange={(event) => setAdminStationForm((current) => ({
                            ...current,
                            questionDraft: {
                              ...current.questionDraft,
                              type: event.target.value as typeof current.questionDraft.type,
                            },
                          }))}
                          className="rounded-xl border border-[#d8c6a2] bg-white p-3 text-sm"
                        >
                          <option value="text">Textová odpověď</option>
                          <option value="number">Číselná odpověď</option>
                          <option value="multiple-choice">Výběr z možností</option>
                        </select>
                        {adminStationForm.questionDraft.type === "multiple-choice" && (
                          <textarea
                            value={adminStationForm.questionDraft.optionsText}
                            onChange={(event) => setAdminStationForm((current) => ({
                              ...current,
                              questionDraft: { ...current.questionDraft, optionsText: event.target.value },
                            }))}
                            placeholder="Možnosti, každá na samostatný řádek"
                            rows={3}
                            className="rounded-xl border border-[#d8c6a2] bg-white p-3 text-sm sm:col-span-2"
                          />
                        )}
                        <input
                          value={adminStationForm.questionDraft.answer}
                          onChange={(event) => setAdminStationForm((current) => ({
                            ...current,
                            questionDraft: { ...current.questionDraft, answer: event.target.value },
                          }))}
                          placeholder="Správná odpověď (pro admina, volitelné)"
                          className="rounded-xl border border-[#d8c6a2] bg-white p-3 text-sm sm:col-span-2"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const label = adminStationForm.questionDraft.label.trim();
                          const questionOptions = adminStationForm.questionDraft.optionsText
                            .split("\n")
                            .map((option) => option.trim())
                            .filter(Boolean);
                          const uniqueQuestionOptions = [...new Set(questionOptions)];
                          if (!label) {
                            setError("Zadejte znění otázky formuláře.");
                            return;
                          }
                          if (adminStationForm.questionDraft.type === "multiple-choice" && uniqueQuestionOptions.length < 2) {
                            setError("Otázka s výběrem potřebuje alespoň dvě možnosti.");
                            return;
                          }
                          setAdminStationForm((current) => ({
                            ...current,
                            formQuestions: [
                              ...current.formQuestions,
                              {
                                id: crypto.randomUUID(),
                                label,
                                type: current.questionDraft.type,
                                ...(current.questionDraft.type === "multiple-choice" ? { options: uniqueQuestionOptions } : {}),
                                ...(current.questionDraft.answer.trim() ? { answer: current.questionDraft.answer.trim() } : {}),
                              },
                            ],
                            questionDraft: { ...current.questionDraft, label: "", optionsText: "", answer: "" },
                          }));
                          setError("");
                        }}
                        className="rounded-xl border border-[#b18a4b] bg-[#f4e5c5] px-4 py-2.5 text-sm font-bold text-[#5a3c18]"
                      >
                        Přidat otázku
                      </button>
                    </div>
                  )}
                  </div>
                  <div className="contents" style={{ display: stationFormStep === 1 ? "contents" : "none" }}>
                  <details className="station-advanced-settings md:col-span-2">
                    <summary>Schvalování</summary>
                  <label className="flex items-start gap-3 rounded-xl border border-[#e1d4b6] bg-white p-3 text-sm text-[#4d3b2a] md:col-span-2">
                    <input
                      type="checkbox"
                      checked={adminStationForm.requiresApproval}
                      onChange={(event) => setAdminStationForm((current) => ({
                        ...current,
                        requiresApproval: event.target.checked,
                      }))}
                      className="mt-0.5 h-4 w-4 accent-[#a4332b]"
                    />
                    <span>
                      <span className="block font-bold">Požadovat schválení pořadatelem</span>
                      <span className="mt-0.5 block text-xs text-[#756958]">
                        Vypnuto: po validním odevzdání se stanoviště dokončí automaticky.
                      </span>
                    </span>
                  </label>
                  </details>
                  </div>
                </div>
                {error && <p className="mt-3 rounded-xl bg-[#fce7e6] px-3 py-2 text-sm text-[#8b2d2d]">{error}</p>}
                <div className="admin-dialog-actions">
                  <button
                    type="button"
                    onClick={() => stationFormStep === 0 ? setIsStationDialogOpen(false) : setStationFormStep(0)}
                    className="admin-secondary-button"
                  >
                    {stationFormStep === 0 ? "Zrušit" : "Zpět"}
                  </button>
                  {stationFormStep < 1 ? (
                    <div className="flex flex-wrap justify-end gap-2">
                      {!editingStationId && (
                        <button
                          type="button"
                          onClick={() => handleAddStation(true)}
                          className="admin-secondary-button"
                        >
                          Připravit jen QR
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setStationFormStep(1)}
                        className="admin-primary-button"
                      >
                        Pokračovat <ChevronRight size={16} />
                      </button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => handleAddStation()} className="admin-primary-button">
                      {editingStationId ? "Uložit změny" : "Uložit stanoviště"}
                    </button>
                  )}
                </div>
                </div>
              </AdminDialog>
            )}
            </>
            </OsWindow>
          )}

          {isTabOpen("submissions") && (
            <OsWindow {...winProps("submissions")}>
            <section className="rounded-[24px] bg-[#fffdfa] p-4 shadow-[0_12px_30px_rgba(20,16,14,0.08)]">
              <h2 className="mb-4 text-xl font-black text-[#201c19]">Schvalování</h2>
              {error && <p role="alert" className="mb-3 rounded-xl bg-[#fce7e6] px-3 py-2 text-sm text-[#8b2d2d]">{error}</p>}
              <div className="space-y-3">
                {pendingSubmissions.length === 0 ? (
                  <p className="rounded-2xl bg-[#f5efe8] p-3 text-sm text-[#5e4d3f]">Žádné čekající důkazy.</p>
                ) : (
                  pendingSubmissions.map((submission) => {
                    const mission = submission.missionId
                      ? gameState.flashMissions.find((item) => item.id === submission.missionId)
                      : undefined;
                    const station = getStationById(gameState.stations, submission.stationId);
                    const teamName = gameState.teams.find((team) => team.id === submission.teamId)?.name ?? "Tým";
                    return (
                    <div key={submission.id} className="rounded-2xl border border-[#e7d7b4] bg-[#fffaf3] p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-bold text-[#2b2523]">{teamName}</p>
                        <span className="rounded-full bg-[#f6ddab] px-2 py-1 text-[10px] font-bold tracking-[0.12em] text-[#7c5516]">
                          Čeká
                        </span>
                      </div>
                      <p className="mt-2 text-sm font-semibold text-[#52473d]">{mission ? `Přepadový úkol · ${mission.title}` : station?.title ?? "Stanoviště"}</p>
                      {mission && <p className="mt-2 whitespace-pre-wrap rounded-lg bg-white p-3 text-sm text-[#52473d]"><span className="font-bold">Zadání: </span>{mission.description}</p>}
                      {mission?.type === "photo"
                        ? <p className="mt-2 text-xs font-semibold text-[#6f5a49]">Důkaz: fotografie</p>
                        : <SubmissionAnswerReview station={mission ? undefined : station} evidence={submission.evidence} />}
                      {isStoredMediaUrl(submission.mediaUrl) && (mission?.type === "photo" || station?.type === "photo") && (
                        <Image
                          src={submission.mediaUrl}
                          alt={`Fotografie od týmu ${teamName}`}
                          width={960}
                          height={640}
                          unoptimized
                          className="mt-3 max-h-80 w-full rounded-xl bg-[#f1ece4] object-contain"
                        />
                      )}
                      {isStoredMediaUrl(submission.mediaUrl) && station?.type === "video" && (
                        <video
                          controls
                          preload="metadata"
                          src={submission.mediaUrl}
                          className="mt-3 max-h-80 w-full rounded-xl bg-black"
                        />
                      )}
                      <div className="mt-3 flex gap-2">
                        <button onClick={() => handleSubmissionDecision(submission.id, "approved")} className="flex-1 rounded-xl bg-[#dff4e6] px-3 py-2 text-sm font-bold text-[#1e5131]">Schválit</button>
                        <button onClick={() => handleSubmissionDecision(submission.id, "rejected", "Důkaz nebyl dostatečný.")} className="flex-1 rounded-xl bg-[#fbe5e1] px-3 py-2 text-sm font-bold text-[#693025]">Zamítnout</button>
                      </div>
                    </div>
                    );
                  })
                )}
              </div>
            </section>
            </OsWindow>
          )}

          {isTabOpen("media") && isOwnerAdmin && (
            <OsWindow {...winProps("media")}>
            <section className="rounded-[24px] bg-[#fffdfa] p-4 shadow-[0_12px_30px_rgba(20,16,14,0.08)]">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-black text-[#201c19]">Galerie důkazů</h2>
                  <p className="mt-1 text-sm text-[#675d53]">{mediaSubmissions.length} odevzdaných fotografií a videí</p>
                </div>
                {mediaSubmissions.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setPresentationIndex(0)}
                    className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-[#312d27] px-3 py-2.5 text-xs font-bold text-white transition hover:bg-[#4a4137] sm:px-4 sm:text-sm"
                  >
                    <Play size={16} /> Prezentace
                  </button>
                )}
              </div>
              {mediaSubmissions.length === 0 ? (
                <p className="rounded-xl bg-[#f5efe8] p-4 text-sm text-[#5e4d3f]">Zatím nebyly odevzdány žádné fotografie ani videa.</p>
              ) : (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {visibleMediaSubmissions.map((submission) => {
                    const station = getStationById(gameState.stations, submission.stationId);
                    const mission = submission.missionId
                      ? gameState.flashMissions.find((item) => item.id === submission.missionId)
                      : undefined;
                    const team = gameState.teams.find((item) => item.id === submission.teamId);
                    const mediaUrl = submission.mediaUrl;
                    if (!isStoredMediaUrl(mediaUrl)) return null;
                    const isPhoto = /\.(jpg|png|webp|gif|avif)$/i.test(mediaUrl);
                    return (
                      <article key={submission.id} className="admin-media-card overflow-hidden rounded-xl border border-[#e7d7b4] bg-[#fffaf3]">
                        {isPhoto ? (
                          <Image
                            src={mediaUrl}
                            alt={`Důkaz od týmu ${team?.name ?? "tým"}`}
                            width={960}
                            height={640}
                            unoptimized
                            className="h-52 w-full bg-[#f1ece4] object-contain"
                          />
                        ) : (
                          <video
                            controls
                            preload="metadata"
                            src={mediaUrl}
                            className="h-52 w-full bg-black object-contain"
                          />
                        )}
                        <div className="p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-bold text-[#2b2523]">{team?.name ?? "Tým"}</p>
                              <p className="mt-1 truncate text-xs text-[#6f5a49]">
                                {mission?.sourceTeamName
                                  ? `${mission.title} · přepad od ${mission.sourceTeamName}`
                                  : mission?.title ?? (submission.missionId ? "Přepadový úkol" : station?.title ?? "Odstraněné stanoviště")}
                              </p>
                            </div>
                            <span className="shrink-0 rounded-full bg-[#f6ddab] px-2 py-1 text-[10px] font-bold text-[#7c5516]">
                              {submission.status === "pending" ? "Čeká" : submission.status === "approved" ? "Schváleno" : "Zamítnuto"}
                            </span>
                          </div>
                          <p className="mt-2 text-[11px] text-[#806f5b]">
                            {new Date(submission.createdAt).toLocaleString("cs-CZ")}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => setPresentationIndex(mediaSubmissions.findIndex((item) => item.id === submission.id))}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-[#312d27] px-3 py-2 text-xs font-bold text-white"
                            >
                              <Play size={14} /> Prezentovat
                            </button>
                            <a
                              href={`${mediaUrl}?download=1`}
                              download
                              className="inline-flex items-center gap-1.5 rounded-lg border border-[#d9c9aa] bg-white px-3 py-2 text-xs font-bold text-[#4d3b2a]"
                            >
                              <Download size={14} /> Stáhnout
                            </a>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
              {galleryPageCount > 1 && (
                <nav aria-label="Stránkování galerie" className="mt-5 flex items-center justify-between border-t border-[#e8dccb] pt-4">
                  <button
                    type="button"
                    onClick={() => setGalleryPage((page) => Math.max(0, page - 1))}
                    disabled={galleryPage === 0}
                    className="inline-flex items-center gap-1 rounded-lg border border-[#d9c9aa] bg-white px-3 py-2 text-sm font-semibold text-[#4d3b2a] disabled:opacity-45"
                  >
                    <ChevronLeft size={16} /> Předchozí
                  </button>
                  <span className="text-sm font-medium text-[#675d53]">Strana {galleryPage + 1} z {galleryPageCount}</span>
                  <button
                    type="button"
                    onClick={() => setGalleryPage((page) => Math.min(galleryPageCount - 1, page + 1))}
                    disabled={galleryPage + 1 >= galleryPageCount}
                    className="inline-flex items-center gap-1 rounded-lg border border-[#d9c9aa] bg-white px-3 py-2 text-sm font-semibold text-[#4d3b2a] disabled:opacity-45"
                  >
                    Další <ChevronRight size={16} />
                  </button>
                </nav>
              )}
              {presentationIndex !== null && mediaSubmissions[presentationIndex] && (() => {
                const submission = mediaSubmissions[presentationIndex];
                const station = getStationById(gameState.stations, submission.stationId);
                const mission = submission.missionId
                  ? gameState.flashMissions.find((item) => item.id === submission.missionId)
                  : undefined;
                const team = gameState.teams.find((item) => item.id === submission.teamId);
                const mediaUrl = submission.mediaUrl;
                if (!isStoredMediaUrl(mediaUrl)) return null;
                const isPhoto = /\.(jpg|png|webp|gif|avif)$/i.test(mediaUrl);
                return (
                  <div
                    role="dialog"
                    aria-modal="true"
                    aria-label="Prezentace galerie"
                    className="fixed inset-0 z-50 flex items-center justify-center bg-[#151411]/95 p-4 text-white"
                  >
                    <div className="flex max-h-full w-full max-w-6xl flex-col">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold">
                            {team?.name ?? "Tým"} · {mission?.sourceTeamName
                              ? `${mission.title} · přepad od ${mission.sourceTeamName}`
                              : mission?.title ?? (submission.missionId ? "Přepadový úkol" : station?.title ?? "Galerie")}
                          </p>
                          <p className="text-xs text-white/65">{presentationIndex + 1} / {mediaSubmissions.length}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setPresentationIndex(null)}
                          aria-label="Zavřít prezentaci"
                          className="rounded-full bg-white/10 p-2.5 text-white transition hover:bg-white/20"
                        >
                          <X size={20} />
                        </button>
                      </div>
                      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-2xl bg-black">
                        {isPhoto ? (
                          <Image
                            src={mediaUrl}
                            alt={`Fotografie od týmu ${team?.name ?? ""}`}
                            width={1600}
                            height={1200}
                            unoptimized
                            className="max-h-[72vh] w-full object-contain"
                          />
                        ) : (
                          <video controls autoPlay muted src={mediaUrl} className="max-h-[72vh] w-full object-contain" />
                        )}
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => setPresentationIndex((index) => index === null ? 0 : Math.max(0, index - 1))}
                          disabled={presentationIndex === 0}
                          className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold disabled:opacity-35"
                        >
                          <ChevronLeft size={18} /> Předchozí
                        </button>
                        <a href={`${mediaUrl}?download=1`} download className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-bold text-[#29251f]">
                          <Download size={16} /> Stáhnout
                        </a>
                        <button
                          type="button"
                          onClick={() => setPresentationIndex((index) => index === null ? 0 : Math.min(mediaSubmissions.length - 1, index + 1))}
                          disabled={presentationIndex + 1 >= mediaSubmissions.length}
                          className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold disabled:opacity-35"
                        >
                          Další <ChevronRight size={18} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </section>
            </OsWindow>
          )}

          {isTabOpen("managers") && isOwnerAdmin && (
            <OsWindow {...winProps("managers")}>
            <section className="rounded-[24px] bg-[#fffdfa] p-4 shadow-[0_12px_30px_rgba(20,16,14,0.08)]">
              <h2 className="text-xl font-black text-[#201c19]">Správci</h2>
              <p className="mt-1 text-sm text-[#675d53]">
                Správce se přihlásí na běžné přihlašovací stránce týmů svým jménem a heslem a dostane se do administrace.
                Nemůže spravovat další správce.
              </p>
              <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <input
                  value={managerForm.username}
                  onChange={(event) => setManagerForm((current) => ({ ...current, username: event.target.value }))}
                  placeholder="Jméno správce"
                  maxLength={80}
                  autoComplete="off"
                  className="rounded-xl border border-[#d8c6a2] bg-white p-3 text-sm"
                />
                <input
                  type="password"
                  value={managerForm.password}
                  onChange={(event) => setManagerForm((current) => ({ ...current, password: event.target.value }))}
                  placeholder="Heslo (alespoň 8 znaků)"
                  autoComplete="new-password"
                  className="rounded-xl border border-[#d8c6a2] bg-white p-3 text-sm"
                />
                <button
                  type="button"
                  onClick={() => void handleCreateManager()}
                  disabled={managerBusy}
                  className="admin-primary-button"
                >
                  Přidat správce
                </button>
              </div>
              {managerError && <p role="alert" className="mt-3 rounded-xl bg-[#fce7e6] px-3 py-2 text-sm text-[#8b2d2d]">{managerError}</p>}
              <div className="mt-4 space-y-2">
                {managers.length === 0 ? (
                  <p className="rounded-xl bg-[#f5efe8] p-4 text-sm text-[#5e4d3f]">Zatím nejsou přidaní žádní další správci.</p>
                ) : managers.map((manager) => (
                  <div key={manager.id} className="flex items-center justify-between gap-3 rounded-xl border border-[#e7d7b4] bg-[#fffaf3] p-3">
                    <div className="min-w-0">
                      <p className="truncate font-bold text-[#2b2523]">{manager.username}</p>
                      <p className="text-xs text-[#756958]">Vytvořen {new Date(manager.createdAt).toLocaleDateString("cs-CZ")}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleDeleteManager(manager)}
                      disabled={managerBusy}
                      aria-label={`Odebrat správce ${manager.username}`}
                      className="admin-danger-button"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
            </OsWindow>
          )}

          {isTabOpen("flash") && (
            <OsWindow {...winProps("flash")}>
            <section className="rounded-[24px] bg-[#fffdfa] p-4 shadow-[0_12px_30px_rgba(20,16,14,0.08)]">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="admin-eyebrow">Mimořádná výzva</p>
                  <h2 className="mt-1 text-xl font-black text-[#201c19]">Přepadové úkoly</h2>
                  <p className="mt-1 text-sm text-[#675d53]">Zadání, odpovědi a schválení na jednom místě.</p>
                </div>
                <button
                  type="button"
                  onClick={() => { setError(""); setIsFlashDialogOpen(true); }}
                  disabled={gameState.teams.length === 0}
                  className="admin-primary-button"
                >
                  <Plus size={17} /> Nový přepad
                </button>
              </div>
              {isFlashDialogOpen && (
                <AdminDialog
                  title="Nový přepadový úkol"
                  description="Napište srozumitelné zadání, vyberte týmy a nastavte schvalování."
                  onClose={() => setIsFlashDialogOpen(false)}
                  variant="drawer"
                >
                <div className="admin-dialog-body">
                <div className="admin-flash-form grid gap-3 md:grid-cols-2">
                <label className="admin-field-label md:col-span-2">
                  Název výzvy
                  <input
                    value={flashMissionForm.title}
                    onChange={(event) => setFlashMissionForm((current) => ({ ...current, title: event.target.value }))}
                    placeholder="Například: Tajná zpráva"
                    maxLength={100}
                    className="w-full rounded-xl border border-[#d8c6a2] bg-[#faf5ee] p-3 text-sm md:col-span-2"
                  />
                </label>
                <label className="admin-field-label md:col-span-2">
                  Konkrétní zadání
                  <textarea
                    value={flashMissionForm.description}
                    onChange={(event) => setFlashMissionForm((current) => ({ ...current, description: event.target.value }))}
                    placeholder="Napište přesně, co mají týmy udělat a co odevzdat."
                    maxLength={2000}
                    rows={4}
                    className="w-full rounded-xl border border-[#d8c6a2] bg-[#faf5ee] p-3 text-sm md:col-span-2"
                  />
                </label>
                <label className="admin-field-label">
                  Způsob odevzdání
                  <select
                    value={flashMissionForm.type === "photo" ? "photo" : "text"}
                    onChange={(event) => setFlashMissionForm((current) => ({
                      ...current,
                      type: event.target.value === "photo" ? "photo" : "text",
                    }))}
                    className="w-full rounded-xl border border-[#d8c6a2] bg-[#faf5ee] p-3 text-sm"
                  >
                    <option value="text">Textová odpověď</option>
                    <option value="photo">Fotografie</option>
                  </select>
                </label>
                <label className="admin-field-label">
                  Komu se výzva zobrazí
                  <select
                    value={flashMissionForm.targets}
                    onChange={(event) => setFlashMissionForm((current) => ({ ...current, targets: event.target.value as "all" | "specific" }))}
                    className="w-full rounded-xl border border-[#d8c6a2] bg-[#faf5ee] p-3 text-sm"
                  >
                    <option value="all">Všem týmům</option>
                    <option value="specific">Vybraným týmům</option>
                  </select>
                </label>
                {flashMissionForm.targets === "specific" && (
                  <fieldset className="admin-flash-team-picker grid gap-2 rounded-xl border border-[#e5d9c7] bg-[#fffaf3] p-3 sm:grid-cols-2 md:col-span-2">
                    <legend className="px-1 text-xs font-bold uppercase tracking-wide text-[#756958]">Vyberte týmy</legend>
                    {gameState.teams.map((team) => (
                      <label key={team.id} className="flex items-center gap-2 text-sm text-[#3d3127]">
                        <input
                          type="checkbox"
                          checked={flashMissionForm.targetTeamIds.includes(team.id)}
                          onChange={(event) => {
                            const nextIds = event.target.checked
                              ? [...flashMissionForm.targetTeamIds, team.id]
                              : flashMissionForm.targetTeamIds.filter((id) => id !== team.id);
                            setFlashMissionForm((current) => ({ ...current, targetTeamIds: nextIds }));
                          }}
                        />
                        {team.name}
                      </label>
                    ))}
                  </fieldset>
                )}
                <label className="flex items-start gap-3 rounded-xl border border-[#e1d4b6] bg-[#fffaf3] p-3 text-sm text-[#4d3b2a] md:col-span-2">
                  <input
                    type="checkbox"
                    checked={flashMissionForm.requiresApproval}
                    onChange={(event) => setFlashMissionForm((current) => ({
                      ...current,
                      requiresApproval: event.target.checked,
                    }))}
                    className="mt-0.5 h-4 w-4 accent-[#a4332b]"
                  />
                  <span>
                    <span className="block font-bold">Odpověď musí schválit pořadatel</span>
                    <span className="mt-0.5 block text-xs text-[#756958]">Pokud volbu vypnete, odevzdaná odpověď úkol automaticky dokončí.</span>
                  </span>
                </label>
                {error && <p role="alert" className="rounded-xl bg-[#fce7e6] px-3 py-2 text-sm text-[#8b2d2d] md:col-span-2">{error}</p>}
                <button
                  onClick={launchFlashMission}
                  disabled={gameState.teams.length === 0}
                  className="admin-primary-button md:col-span-2"
                >
                  Odeslat přepadový úkol
                </button>
                </div>
                </div>
                </AdminDialog>
              )}
              <div className="mt-6 border-t border-[#ece3d5] pt-5">
                <h3 className="mb-3 text-base font-bold text-[#201c19]">Aktivní výzvy</h3>
                {gameState.flashMissions.filter((mission) => !mission.archivedAt).length === 0 ? (
                  <p className="rounded-xl bg-[#f5efe8] p-3 text-sm text-[#675d53]">Žádná přepadová výzva neběží.</p>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {gameState.flashMissions.filter((mission) => !mission.archivedAt).map((mission) => (
                      <article key={mission.id} className="rounded-xl border border-[#e7d7b4] bg-[#fffaf3] p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="font-bold text-[#2b2523]">{mission.title}</h3>
                            <p className="mt-1 text-[11px] font-semibold text-[#795b42]">
                              {mission.type === "photo" ? "Fotografický důkaz" : "Textová odpověď"}
                            </p>
                          </div>
                          <span className="shrink-0 rounded-full bg-[#f6ddab] px-2 py-1 text-[10px] font-bold text-[#7c5516]">
                            {mission.requiresApproval ? "Ke schválení" : "Automaticky"}
                          </span>
                        </div>
                        <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-[#675d53]">{mission.description}</p>
                        <p className="mt-3 text-xs font-semibold text-[#756958]">
                          Týmy: {mission.targetTeamIds.map((id) => gameState.teams.find((team) => team.id === id)?.name).filter(Boolean).join(", ") || "—"}
                        </p>
                      </article>
                    ))}
                  </div>
                )}
              </div>
              <details className="trail-archive mt-4">
                <summary>
                  Archiv výprav
                  <span>{gameState.submissions.filter((submission) => submission.archivedAt).length} důkazů</span>
                </summary>
                <div className="trail-archive-list">
                  {gameState.submissions.filter((submission) => submission.archivedAt).length === 0 ? (
                    <p>Zatím tu nejsou archivované důkazy.</p>
                  ) : (
                    [...gameState.submissions]
                      .filter((submission) => submission.archivedAt)
                      .sort((first, second) => second.createdAt.localeCompare(first.createdAt))
                      .map((submission) => {
                        const mission = submission.missionId
                          ? gameState.flashMissions.find((item) => item.id === submission.missionId)
                          : undefined;
                        const station = getStationById(gameState.stations, submission.stationId);
                        const team = gameState.teams.find((item) => item.id === submission.teamId);
                        const title = mission?.title ?? station?.title ?? "Úkol";
                        const mediaUrl = submission.mediaUrl;
                        return (
                          <article key={submission.id}>
                            <div>
                              <strong>{team?.name ?? "Odstraněný tým"} · {title}</strong>
                              <time dateTime={submission.createdAt}>{new Date(submission.createdAt).toLocaleString("cs-CZ")}</time>
                            </div>
                            {isStoredMediaUrl(mediaUrl) ? (
                              <a href={`${mediaUrl}?download=1`} download className="trail-archive-download">
                                <Download size={14} /> Stáhnout důkaz
                              </a>
                            ) : (
                              <p className="whitespace-pre-wrap">{formatEvidence(station, submission.evidence)}</p>
                            )}
                          </article>
                        );
                      })
                  )}
                </div>
              </details>
            </section>
            </OsWindow>
          )}
            </div>
          </div>
          </main>
        </div>
      )}

      {teamQrScannerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
          <div className="scanner-modal w-full max-w-md rounded-2xl p-4 shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#f4ead8] text-[#7a3d2e]"><QrCode size={20} /></span>
                <div>
                  <h3 className="text-lg font-bold text-[#30251e]">Přihlášení QR kódem</h3>
                  <p className="text-xs text-[#75685c]">Naskenujte kód svého týmu</p>
                </div>
              </div>
              <button
                aria-label="Zavřít přihlašovací skener"
                onClick={() => setTeamQrScannerOpen(false)}
                className="rounded-lg p-2 text-[#68707d] transition hover:bg-[#f1ede6]"
              >
                <X size={20} />
              </button>
            </div>
            <div className="qr-camera-frame relative overflow-hidden rounded-xl">
              <div id="team-qr-login-reader" className="qr-reader-element overflow-hidden rounded-xl bg-[#111827]" />
              <div className="qr-camera-guide" aria-hidden="true">
                <div className="qr-camera-target"><span /><span /><span /><span /></div>
              </div>
              <div className="qr-camera-caption"><Camera size={14} /> Zarovnejte přihlašovací QR do rámečku</div>
            </div>
            <p role="status" className="mt-3 flex min-h-10 items-center gap-2 rounded-lg bg-[#f4f0e8] px-3 py-2 text-sm text-[#584e44]">
              <Camera size={16} className="shrink-0 text-[#7a3d2e]" /> {teamQrScanMessage}
            </p>
            <button
              onClick={() => setTeamQrScannerOpen(false)}
              className="mt-3 w-full rounded-lg border border-[#d9cbb7] bg-white px-3 py-2.5 text-sm font-semibold text-[#4d4339] transition hover:bg-[#f7f2e9]"
            >
              Zavřít
            </button>
          </div>
        </div>
      )}

      {scannerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
          <div className="scanner-modal w-full max-w-md rounded-[28px] bg-[#fffdfa] p-4 shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#f8eceb] text-[#a4332b]"><ScanLine size={20} /></span>
                <div>
                  <h3 className="text-lg font-bold text-[#1d1a17]">Naskenovat QR</h3>
                  <p className="text-xs text-[#68707d]">Používá se zadní kamera zařízení</p>
                </div>
              </div>
              <button aria-label="Zavřít skener" onClick={() => setScannerOpen(false)} className="rounded-xl p-2 text-[#68707d] transition hover:bg-[#f1f2f4]"><X size={20} /></button>
            </div>
            <div className="qr-camera-frame relative overflow-hidden rounded-2xl">
              <div id="qr-reader-element" className="qr-reader-element overflow-hidden rounded-2xl bg-[#111827]" />
              <div className="qr-camera-guide" aria-hidden="true">
                <div className="qr-camera-target"><span /><span /><span /><span /></div>
              </div>
              <div className="qr-camera-caption"><Camera size={14} /> Zarovnejte QR kód do rámečku</div>
            </div>
            <p role="status" className="mt-3 flex min-h-10 items-center gap-2 rounded-xl bg-[#f5f6f8] px-3 py-2 text-sm text-[#58606d]">
              <Camera size={16} className="shrink-0 text-[#a4332b]" /> {scanMessage}
            </p>
            <div className="mt-3 flex gap-3">
              <button onClick={handleManualUid} className="flex-1 rounded-xl border border-[#e2e5e9] bg-white px-3 py-2.5 text-sm font-semibold text-[#4d5563] transition hover:bg-[#f5f6f8]">Zadat UID ručně</button>
              <button onClick={() => setScannerOpen(false)} className="flex-1 rounded-xl bg-[#a4332b] px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-[#85271f]">Zavřít</button>
            </div>
          </div>
        </div>
      )}

      {manualUidOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submitManualUid();
            }}
            className="w-full max-w-sm rounded-[24px] bg-[#fffdfa] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.35)]"
          >
            <h2 className="text-2xl font-bold text-[#1d1a17]">Zadat kód stanoviště</h2>
            <label className="mt-4 block text-sm font-semibold text-[#3f3428]">
              Osmimístný kód
              <input
                autoFocus
                value={manualUidDraft}
                onChange={(event) => setManualUidDraft(event.target.value.toUpperCase())}
                maxLength={8}
                className="mt-2 w-full rounded-xl border border-[#d5c5a0] bg-[#fbf7f0] px-4 py-3 text-base uppercase tracking-[0.14em]"
              />
            </label>
            {error && <p className="mt-3 rounded-xl bg-[#fce7e6] px-3 py-2 text-sm text-[#8b2d2d]">{error}</p>}
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setManualUidOpen(false)}
                className="flex-1 rounded-xl bg-[#f1e4c9] px-3 py-3 text-sm font-bold text-[#6d4d20]"
              >
                Zrušit
              </button>
              <button
                type="submit"
                className="flex-1 rounded-xl bg-[#a4332b] px-3 py-3 text-sm font-bold text-white"
              >
                Otevřít
              </button>
            </div>
          </form>
        </div>
      )}

      {stationResultAnimation &&
        stationResultAnimation.teamId === activeTeam?.id &&
        screen === "team-dashboard" && (
        <div
          key={stationResultAnimation.key}
          className={classNames(
            "station-result-animation",
            stationResultAnimation.result === "rejected" && "station-result-animation-rejected",
          )}
          role="status"
          aria-label={stationResultAnimation.result === "completed" ? "Stanoviště splněno" : "Odpověď nebyla schválena"}
        >
          <span className="station-result-animation-ring" aria-hidden="true">
            {stationResultAnimation.result === "completed"
              ? <Check size={34} strokeWidth={2.6} />
              : <X size={31} strokeWidth={2.6} />}
          </span>
        </div>
      )}

      {isLoggingIn && (
        <div className="auth-transition" role="status" aria-live="polite" aria-busy="true">
          <span className="auth-transition-spinner" aria-hidden="true" />
          <p>{loginStatus}</p>
          <span className="auth-transition-caption">Chvilku strpení, připravujeme vaši výpravu.</span>
        </div>
      )}

    </main>
  );
}

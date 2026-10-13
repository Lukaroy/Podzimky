"use client";

import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { put } from "@vercel/blob/client";
import {
  inMemoryPersistence,
  setPersistence,
  signInWithCustomToken,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import Image from "next/image";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  Eye,
  EyeOff,
  Images,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  QrCode,
  ScanLine,
  Trash2,
  Users,
  X,
  Zap,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getFirebaseAuth } from "@/lib/firebase-client";

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
type AuthVisualMode = "sunset" | "interior";

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
  instructions?: string;
  options?: string[];
  answer?: string;
  image?: string;
  formQuestions?: Array<{
    id: string;
    label: string;
    type: "text" | "number" | "multiple-choice";
    options?: string[];
  }>;
};

type Submission = {
  id: string;
  stationId: string;
  teamId: string;
  status: SubmissionStatus;
  content: string;
  evidence: string;
  mediaUrl?: string;
  comment: string;
  createdAt: string;
};

type Team = {
  id: string;
  name: string;
  password: string;
  completedStations: string[];
  scannedStationIds: string[];
  flashMissionId?: string;
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
};

type GameEvent = {
  id: string;
  teamId?: string;
  message: string;
  tone: "info" | "success" | "warning";
  createdAt: string;
};

type GameState = {
  stations: Station[];
  teams: Team[];
  submissions: Submission[];
  flashMissions: FlashMission[];
  events: GameEvent[];
};

const emptyGameState: GameState = {
  stations: [],
  teams: [],
  submissions: [],
  flashMissions: [],
  events: [],
};

function getNextOrder(team: Team | null | undefined, stations: Station[]): number {
  if (!team) return 1;
  const completedOrders = stations
    .filter((station) => team.completedStations.includes(station.id))
    .map((station) => station.order);

  return Math.max(...completedOrders, 0) + 1;
}

function getStationById(stations: Station[], stationId?: string | null) {
  if (!stationId) return undefined;
  return stations.find((station) => station.id === stationId);
}

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

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
    </div>
  );
}

function AdminIcon({ name }: { name: "overview" | "teams" | "stations" | "review" | "media" | "flash" }) {
  const icons = {
    overview: LayoutDashboard,
    teams: Users,
    stations: MapPin,
    review: ClipboardCheck,
    media: Images,
    flash: Zap,
  };
  const Icon = icons[name];
  return <Icon aria-hidden="true" size={18} strokeWidth={1.8} className="shrink-0" />;
}

function isValidUid(uid: string) {
  return /^[A-Z0-9]{8}$/i.test(uid.trim());
}

function isStoredMediaUrl(url: string | undefined): url is string {
  return Boolean(url && /^\/api\/media\/team-[A-Za-z0-9_-]{1,128}\/[0-9a-f-]{36}\.(jpg|png|webp|gif|avif|mp4|webm|mov)$/i.test(url));
}

function createUniqueStationUid(stations: Station[]) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const existingUids = new Set(stations.map((station) => station.uid.toUpperCase()));
  let uid = "";

  do {
    const randomValues = crypto.getRandomValues(new Uint8Array(8));
    uid = Array.from(randomValues, (value) => alphabet[value % alphabet.length]).join("");
  } while (existingUids.has(uid));

  return uid;
}

function downloadStationQrSvg(uid: string, fileName: string) {
  const qrCode = Array.from(document.querySelectorAll<SVGSVGElement>("[data-qr-uid]")).find(
    (element) => element.dataset.qrUid === uid,
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

function createEvent(message: string, tone: GameEvent["tone"] = "info", teamId?: string): GameEvent {
  return {
    id: crypto.randomUUID(),
    teamId,
    message,
    tone,
    createdAt: new Date().toISOString(),
  };
}

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
        }))
      : [],
    submissions: Array.isArray(safeValue.submissions) ? safeValue.submissions : [],
    flashMissions: Array.isArray(safeValue.flashMissions) ? safeValue.flashMissions : [],
    events: Array.isArray(safeValue.events) ? safeValue.events : [],
  };
}

export default function Page() {
  const [gameState, setGameState] = useState<GameState>(emptyGameState);
  const [isLoadingGameState, setIsLoadingGameState] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
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
  const [teamForm, setTeamForm] = useState({ name: "", password: "" });
  const [adminForm, setAdminForm] = useState({ email: "", password: "" });
  const teamNameInputRef = useRef<HTMLInputElement | null>(null);
  const teamPasswordInputRef = useRef<HTMLInputElement | null>(null);
  const adminUsernameInputRef = useRef<HTMLInputElement | null>(null);
  const adminPasswordInputRef = useRef<HTMLInputElement | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [deletingTeamId, setDeletingTeamId] = useState<string | null>(null);
  const [teamQrBusyId, setTeamQrBusyId] = useState<string | null>(null);
  const [generatedTeamQr, setGeneratedTeamQr] = useState<{ teamId: string; value: string } | null>(null);
  const [isAdminMenuOpen, setIsAdminMenuOpen] = useState(false);
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
  });
  const [visibleStationQr, setVisibleStationQr] = useState<string | null>(null);
  const [teamFormAdmin, setTeamFormAdmin] = useState({
    name: "",
    password: "",
  });
  const [flashMissionForm, setFlashMissionForm] = useState({
    title: "",
    description: "",
    type: "text" as StationType,
    targets: "all",
    targetTeamIds: [] as string[],
    requiresApproval: true,
  });
  const [adminTab, setAdminTab] = useState<"overview" | "teams" | "stations" | "submissions" | "media" | "flash">("overview");

  useEffect(() => () => {
    mediaPreviewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    let isMounted = true;

    fetch("/api/auth/session")
      .then((response) => {
        if (response.status === 401) return null;
        if (!response.ok) {
          throw new Error("Unable to load game state");
        }
        return response.json() as Promise<{ user: { role: "admin" } | { role: "team"; teamId: string }; state: GameState }>;
      })
      .then((session) => {
        if (isMounted) {
          if (session) {
            const state = normalizeGameState(session.state);
            lastPersistedStateRef.current = JSON.stringify(state);
            setGameState(state);
            const sessionUser = session.user;
            if (sessionUser.role === "admin") {
              setScreen("admin-panel");
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
  }, []);

  useEffect(() => {
    if (
      !isAuthenticated ||
      screen !== "team-dashboard" ||
      !teamId ||
      cameraPermissionRequestedRef.current
    ) {
      return;
    }

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

    const scanner = new Html5Qrcode("qr-reader-element", {
      formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
      useBarCodeDetectorIfSupported: true,
      verbose: false,
    });
    let isDisposed = false;
    let startSettled = false;
    let hasScanned = false;

    const clearScanner = () => {
      scanner.clear();
    };

    void scanner.start(
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
    ).then(async () => {
      startSettled = true;
      if (isDisposed && scanner.isScanning) await scanner.stop();
      if (isDisposed) clearScanner();
    }).catch((scanError: unknown) => {
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
    });

    return () => {
      isDisposed = true;
      if (scanner.isScanning) {
        void scanner.stop().then(clearScanner).catch((stopError: unknown) => {
          console.error("QR scanner could not be stopped cleanly.", stopError);
        });
      } else if (startSettled) {
        clearScanner();
      }
    };
  }, [scannerOpen, handleScanResult]);

  const completeTeamLogin = useCallback(async (customToken: string) => {
    const auth = getFirebaseAuth();
    await setPersistence(auth, inMemoryPersistence);
    const credential = await signInWithCustomToken(auth, customToken);
    const response = await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: await credential.user.getIdToken() }),
    });
    const result = await response.json() as {
      user?: { role: "team"; teamId: string };
      state?: GameState;
      error?: string;
    };
    if (!response.ok || !result.user || !result.state) {
      throw new Error(result.error ?? "Přihlášení týmu se nezdařilo.");
    }
    const state = normalizeGameState(result.state);
    lastPersistedStateRef.current = JSON.stringify(state);
    const team = state.teams.find((item) => item.id === result.user?.teamId);
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
  }, []);

  const handleTeamLogin = async () => {
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
    }
  };

  const handleTeamQrLogin = useCallback(async (decodedText: string) => {
    const prefix = "podzimky-team-login:";
    if (!decodedText.startsWith(prefix)) {
      setError("Tento QR kód není přihlašovací kód týmu.");
      setTeamQrScanMessage("Tento kód není určený k přihlášení týmu.");
      return;
    }

    try {
      setError("");
      setTeamQrScanMessage("Kód načten, ověřuji přihlášení…");
      const response = await fetch("/api/auth/qr-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: decodedText.slice(prefix.length) }),
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
    }
  }, [completeTeamLogin]);

  useEffect(() => {
    if (!teamQrScannerOpen) return;

    const scanner = new Html5Qrcode("team-qr-login-reader", {
      formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
      useBarCodeDetectorIfSupported: true,
      verbose: false,
    });
    let isDisposed = false;
    let startSettled = false;
    let hasScanned = false;

    void scanner.start(
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
    ).then(async () => {
      startSettled = true;
      if (isDisposed && scanner.isScanning) await scanner.stop();
      if (isDisposed) scanner.clear();
    }).catch((scanError: unknown) => {
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
        scanner.clear();
      }
    });

    return () => {
      isDisposed = true;
      if (scanner.isScanning) {
        void scanner.stop().then(() => scanner.clear()).catch((stopError: unknown) => {
          console.error("QR login scanner could not be stopped cleanly.", stopError);
        });
      } else if (startSettled) {
        scanner.clear();
      }
    };
  }, [teamQrScannerOpen, handleTeamQrLogin]);

  const handleAdminLogin = async () => {
    const enteredEmail = adminUsernameInputRef.current?.value ?? adminForm.email;
    const enteredPassword = adminPasswordInputRef.current?.value ?? adminForm.password;

    try {
      const auth = getFirebaseAuth();
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
      setIsAuthenticated(true);
      setError("");
      setScreen("admin-panel");
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Přihlášení administrátora se nezdařilo.");
    }
  };

  const handleLogout = async () => {
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Odhlášení se nezdařilo.");
      await signOut(getFirebaseAuth());
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : "Odhlášení se nezdařilo.");
      return;
    }
    setIsAuthenticated(false);
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
          submission.status === "pending",
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
      (station.type === "form" && Object.values(formAnswers).some((answer) => !answer.trim()))
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
        const activeTeam = gameState.teams[0];
        if (!extension || !activeTeam) throw new Error("Nepodporovaný formát souboru.");
        const pathname = `team-${activeTeam.id}/${crypto.randomUUID()}.${extension}`;
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
        let tokenResult: {
          clientToken?: string;
          error?: string;
        } = {};
        try {
          tokenResult = JSON.parse(tokenResponseBody) as typeof tokenResult;
        } catch {
          // Keep the HTTP status useful when a proxy returns a non-JSON error page.
        }
        if (!tokenResponse.ok || !tokenResult.clientToken) {
          throw new Error(
            tokenResult.error ??
              `Server nevydal oprávnění k nahrávání (HTTP ${tokenResponse.status}). Zkuste se znovu přihlásit; pokud chyba trvá, zkontrolujte logy Vercelu pro /api/media/upload.`,
          );
        }

        let blob: Awaited<ReturnType<typeof put>>;
        try {
          blob = await put(
            pathname,
            file,
            {
              access: "private",
              token: tokenResult.clientToken,
              contentType: file.type,
              multipart,
            },
          );
        } catch (uploadError) {
          const message = uploadError instanceof Error ? uploadError.message : "";
          throw new Error(`Soubor se nepodařilo uložit do Blob úložiště: ${message || "neznámá chyba"}`);
        }
        mediaUrl = `/api/media/${blob.pathname}`;
        if (!isStoredMediaUrl(mediaUrl)) throw new Error("Server vrátil neplatný odkaz na soubor.");
      }

      const response = await fetch("/api/team/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stationId: station.id, content, ...(mediaUrl ? { mediaUrl } : {}) }),
      });
      const result = await response.json() as { submission?: Submission; error?: string };
      if (!response.ok || !result.submission) {
        throw new Error(result.error ?? "Úkol se nepodařilo odeslat.");
      }
      const submittedAnswer = result.submission;
      setGameState((previous) => {
        const safePrevious = normalizeGameState(previous);
        return {
          ...safePrevious,
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
      setScanMessage("Úkol byl odeslán. Po schválení dostanete nápovědu k dalšímu stanovišti.");
      setSelectedStationId(station.id);
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Úkol se nepodařilo odeslat.");
    } finally {
      setSubmittingStationId(null);
    }
  };

  const handleManualUid = () => {
    setScannerOpen(false);
    setManualUidDraft("");
    setManualUidOpen(true);
    setError("");
  };

  const submitManualUid = () => {
    if (!isValidUid(manualUidDraft)) {
      setScanMessage("QR kód se nedaří načíst?");
      setError("UID musí mít přesně 8 znaků. Povolené jsou písmena a číslice.");
      return;
    }

    setManualUidOpen(false);
    handleScanResult(manualUidDraft);
  };

  const handleSubmissionDecision = (submissionId: string, status: "approved" | "rejected", comment?: string) => {
    const reviewedSubmission = gameState.submissions.find((submission) => submission.id === submissionId);
    const reviewedStation = getStationById(gameState.stations, reviewedSubmission?.stationId);
    if (status === "approved" && reviewedSubmission && reviewedStation) {
      const nextStation = gameState.stations.find((station) => station.order === reviewedStation.order + 1);
      setSelectedStationId(nextStation?.id ?? reviewedStation.id);
    }

    setGameState((previous) => {
      const safePrevious = normalizeGameState(previous);
      const targetSubmission = safePrevious.submissions.find((submission) => submission.id === submissionId);
      const station = getStationById(safePrevious.stations, targetSubmission?.stationId);
      const nextTeams = status === "approved" && station
        ? safePrevious.teams.map((team) => {
            if (team.id !== targetSubmission?.teamId || team.completedStations.includes(station.id)) return team;
            return { ...team, completedStations: [...team.completedStations, station.id] };
          })
        : safePrevious.teams;

      const nextSubmissions = safePrevious.submissions.map((submission) => {
        if (submission.id !== submissionId) return submission;
        return {
          ...submission,
          status,
          comment: comment ?? submission.comment,
        };
      });

      const team = safePrevious.teams.find((item) => item.id === targetSubmission?.teamId);

      return {
        ...safePrevious,
        teams: nextTeams,
        submissions: nextSubmissions,
        events: [
          createEvent(
            status === "approved"
              ? `Admin schválil ${team?.name ?? "tým"} pro stanoviště ${station?.title ?? "novou úlohu"}.`
              : `Admin zamítl důkaz pro stanoviště ${station?.title ?? "úlohu"}.`,
            status === "approved" ? "success" : "warning",
            team?.id,
          ),
          ...safePrevious.events,
        ].slice(0, 12),
      };
    });
  };

  const handleAddStation = () => {
    if (
      !adminStationForm.title.trim() ||
      !adminStationForm.uid.trim() ||
      !adminStationForm.clue.trim() ||
      !adminStationForm.task.trim()
    ) {
      setError("Vyplňte název, UID, úkol a nápovědu k tomuto stanovišti.");
      return;
    }
    if (!isValidUid(adminStationForm.uid)) {
      setError("UID musí obsahovat přesně 8 písmen nebo číslic.");
      return;
    }
    if (gameState.stations.some((station) => station.uid.toUpperCase() === adminStationForm.uid.toUpperCase())) {
      setError("Toto UID už používá jiné stanoviště. Vygenerujte nové.");
      return;
    }

    const newStation: Station = {
      id: `station-${crypto.randomUUID().slice(0, 8)}`,
      order: gameState.stations.length + 1,
      title: adminStationForm.title.trim(),
      description: adminStationForm.description.trim(),
      clue: adminStationForm.clue.trim(),
      task: adminStationForm.task.trim(),
      uid: adminStationForm.uid.toUpperCase(),
      type: adminStationForm.type,
      requiresApproval: true,
      instructions: adminStationForm.instructions,
    };

    setGameState((previous) => {
      const safePrevious = normalizeGameState(previous);
      return {
        ...safePrevious,
        stations: [...safePrevious.stations, newStation],
        events: [
          createEvent(`Admin přidal nové stanoviště ${newStation.title}.`, "info"),
          ...safePrevious.events,
        ].slice(0, 12),
      };
    });
    setVisibleStationQr(newStation.id);

    setAdminStationForm({
      title: "",
      description: "",
      clue: "",
      task: "",
      uid: "",
      type: "text",
      instructions: "",
    });
    setError("");
  };

  const handleAddTeam = () => {
    const cleanedName = teamFormAdmin.name.trim();
    if (!cleanedName) {
      setError("Název týmu je povinný.");
      return;
    }
    if (teamFormAdmin.password.length < 8) {
      setError("Heslo týmu musí mít alespoň 8 znaků.");
      return;
    }

    const newTeamId = `team-${crypto.randomUUID().slice(0, 8)}`;

    setGameState((previous) => {
      const safePrevious = normalizeGameState(previous);
      return {
        ...safePrevious,
        teams: [
          ...safePrevious.teams,
          {
            id: newTeamId,
            name: cleanedName.toUpperCase(),
            password: teamFormAdmin.password,
            completedStations: [],
            scannedStationIds: [],
          },
        ],
        events: [
          createEvent(`Admin přidal nový tým ${cleanedName.toUpperCase()}.`, "success"),
          ...safePrevious.events,
        ].slice(0, 12),
      };
    });

    setTeamFormAdmin({ name: "", password: "" });
    setError("");
  };

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
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Tým se nepodařilo odstranit.");
    } finally {
      setDeletingTeamId(null);
    }
  };

  const handleGenerateTeamQr = async (team: Team) => {
    if (!window.confirm(`Vygenerováním nového QR kódu přestane fungovat předchozí kód pro tým ${team.name}. Pokračovat?`)) {
      return;
    }

    setTeamQrBusyId(team.id);
    setError("");
    try {
      const response = await fetch(`/api/team/${encodeURIComponent(team.id)}/qr-login`, { method: "POST" });
      const result = await response.json() as { token?: string; error?: string };
      if (!response.ok || !result.token) {
        throw new Error(result.error ?? "Přihlašovací QR kód se nepodařilo vytvořit.");
      }
      setGeneratedTeamQr({ teamId: team.id, value: `podzimky-team-login:${result.token}` });
    } catch (qrError) {
      setError(qrError instanceof Error ? qrError.message : "Přihlašovací QR kód se nepodařilo vytvořit.");
    } finally {
      setTeamQrBusyId(null);
    }
  };

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

  const removeStation = (stationId: string) => {
    setGameState((previous) => ({
      ...previous,
      stations: previous.stations
        .filter((station) => station.id !== stationId)
        .map((station, index) => ({ ...station, order: index + 1 })),
    }));
  };

  const launchFlashMission = () => {
    const selectedTeams =
      flashMissionForm.targets === "all"
        ? gameState.teams.map((team) => team.id)
        : flashMissionForm.targetTeamIds.length > 0
          ? flashMissionForm.targetTeamIds
          : [gameState.teams[0]?.id].filter(Boolean) as string[];

    const mission: FlashMission = {
      id: `mission-${crypto.randomUUID().slice(0, 8)}`,
      title: flashMissionForm.title || "Přepadový úkol",
      description: flashMissionForm.description || "Okamžitě vyplňte úkol.",
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
  };

  const completeFlashMission = async (team: Team) => {
    if (!team.flashMissionId) return;

    try {
      const response = await fetch("/api/team/flash", { method: "POST" });
      const result = await response.json() as { state?: GameState; error?: string };
      if (!response.ok || !result.state) {
        throw new Error(result.error ?? "Přepadový úkol se nepodařilo dokončit.");
      }
      const state = normalizeGameState(result.state);
      lastPersistedStateRef.current = JSON.stringify(state);
      setGameState(state);
      setError("");
    } catch (missionError) {
      setError(missionError instanceof Error ? missionError.message : "Přepadový úkol se nepodařilo dokončit.");
    }
  };

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
    if (file.size === 0 || file.size > 50 * 1024 * 1024) {
      setError("Soubor musí mít velikost do 50 MB.");
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
      ? gameState.flashMissions.find((mission) => mission.id === activeTeam.flashMissionId)
      : null;

  const pendingSubmissions = gameState.submissions.filter((submission) => submission.status === "pending");
  const mediaSubmissions = [...gameState.submissions]
    .filter((submission) => isStoredMediaUrl(submission.mediaUrl))
    .sort((first, second) => second.createdAt.localeCompare(first.createdAt));
  const completedStationsCount = activeTeam ? activeTeam.completedStations.length : 0;
  const hasFinishedGame = Boolean(activeTeam && gameState.stations.length > 0 && completedStationsCount >= gameState.stations.length);

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
          <Image
            src={authVisualMode === "sunset" ? "/podzimky-palace-sunset-hd.jpg" : "/podzimky-palace-interior-hd.jpg"}
            alt=""
            fill
            preload
            sizes="100vw"
            quality={95}
            className="auth-photo"
          />
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

                  <button onClick={handleTeamLogin} className="auth-submit">
                    Vstoupit <ArrowRight size={18} />
                  </button>
                  <div className="auth-login-divider"><span>nebo</span></div>
                  <button
                    type="button"
                    className="auth-qr-login"
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
          <Image
            src={authVisualMode === "sunset" ? "/podzimky-palace-sunset-hd.jpg" : "/podzimky-palace-interior-hd.jpg"}
            alt=""
            fill
            preload
            sizes="100vw"
            quality={95}
            className="auth-photo"
          />
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

                  <button onClick={handleAdminLogin} className="auth-submit">
                    Přihlásit se
                  </button>
                </div>
              </section>
            </div>
          </div>
        </div>
      )}

      {screen === "team-dashboard" && activeTeam && (
        activeFlashMission ? (
          <div className="mx-auto flex min-h-screen max-w-3xl items-center justify-center px-4 py-10">
            <div className="w-full rounded-[30px] border border-[#d5a24a] bg-[#fff5df] p-6 shadow-[0_22px_55px_rgba(116,81,35,0.2)]">
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#8e5d1d]">Přepadový úkol</p>
              <h1 className="mt-3 text-3xl font-black text-[#281d15]">{activeFlashMission.title}</h1>
              <p className="mt-3 text-sm text-[#5d4536]">{activeFlashMission.description}</p>
              <div className="mt-5 rounded-2xl border border-[#e7cf9e] bg-[#fffaf1] p-4 text-sm text-[#483b2e]">
                Tento úkol okamžitě uzamkl běžný režim hry. Nemůžete přejít zpět na dashboard ani pokračovat na další stanoviště, dokud úkol nevyplníte.
              </div>
              <button
                onClick={() => void completeFlashMission(activeTeam)}
                className="mt-6 w-full rounded-2xl bg-[#d59a39] px-4 py-3 text-base font-bold text-[#1d1a17]"
              >
                Dokončit přepadový úkol
              </button>
            </div>
          </div>
        ) : (
          <div className="player-shell mx-auto max-w-5xl px-3 py-4 pb-24 sm:px-5 sm:py-6">
            <header className="player-header sticky top-2 z-20 mb-5 rounded-2xl border p-4 text-[#1e293b] shadow-sm sm:px-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span aria-hidden="true" className="player-seal flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg font-bold">龍</span>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-[0.17em] text-[#8c929b]">Podzimky 2026</p>
                    <h1 className="truncate text-lg font-bold tracking-tight text-[#1f2937] sm:text-xl">{activeTeam.name}</h1>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => {
                    setScanMessage("Spouštím zadní kameru…");
                    setScannerOpen(true);
                  }}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#a4332b] px-3 py-2.5 text-xs font-semibold text-white transition hover:bg-[#85271f] sm:px-4 sm:text-sm"
                >
                  <ScanLine size={16} />
                  <span>Skenovat QR</span>
                </button>
                <button
                  onClick={() => void handleLogout()}
                  aria-label="Odhlásit se"
                  className="inline-flex items-center gap-2 rounded-xl border border-[#e4e7eb] bg-white px-3 py-2.5 text-xs font-semibold text-[#596273] transition hover:bg-[#f6f7f9] sm:text-sm"
                >
                  <LogOut size={16} /><span className="hidden sm:inline">Odhlásit</span>
                </button>
                </div>
              </div>
              <div className="mt-4 border-t border-white/15 pt-3">
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="text-[#6f7783]">Postup výpravy</span>
                  <span className="font-semibold text-[#a4332b]">{completedStationsCount} / {gameState.stations.length}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-[#eceef1]">
                  <div
                    className="h-full rounded-full bg-[#a4332b] transition-all"
                    style={{ width: `${Math.min((completedStationsCount / Math.max(gameState.stations.length, 1)) * 100, 100)}%` }}
                  />
                </div>
              </div>
            </header>

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

            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
              <section className="player-route order-2 rounded-2xl border border-[#e7d8c0] bg-[#fffdfa] p-3 shadow-[0_8px_24px_rgba(29,25,20,0.06)] lg:order-1">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-base font-bold text-[#241d1a]">Trasa</h2>
                  <span className="rounded-full bg-[#f5ebda] px-2.5 py-1 text-xs font-semibold text-[#795b34]">
                    {completedStationsCount} / {gameState.stations.length} hotovo
                  </span>
                </div>

                <details className="player-station-list">
                  <summary className="mb-2 cursor-pointer rounded-lg bg-[#faf5ec] px-3 py-2 text-xs font-semibold text-[#7c4a28]">
                    Zobrazit všechna stanoviště
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

              <section className="player-mission order-1 overflow-hidden rounded-2xl border border-[#e4d4ba] bg-[#fffdfa] shadow-[0_12px_30px_rgba(29,25,20,0.08)] lg:order-2">
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
                    (submission) => submission.teamId === activeTeam.id && submission.stationId === station.id,
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
                            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#8f3529]">Nápověda k místu</p>
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
                              {mediaFiles[station.id] && <p className="text-xs text-[#6f5a49]">{mediaFiles[station.id].name} · do 50 MB</p>}
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
                              {mediaFiles[station.id] && <p className="text-xs text-[#6f5a49]">{mediaFiles[station.id].name} · do 50 MB</p>}
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
                              {station.formQuestions?.map((question) => (
                                <div key={question.id} className="rounded-2xl border border-[#e6dcb7] bg-[#fbf7f0] p-3">
                                  <p className="mb-2 text-sm font-semibold text-[#3f3428]">{question.label}</p>
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
                                      {question.options?.map((option) => (
                                        <label key={option} className="flex items-center gap-2 text-sm">
                                          <input
                                            type="radio"
                                            checked={formDrafts[station.id]?.[question.id] === option}
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
                                      ))}
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
                            {submittingStationId === station.id ? "Nahrávám a odesílám…" : "Odeslat ke schválení"}
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

      {screen === "admin-panel" && (
        <div className="admin-shell mx-auto max-w-screen-2xl px-4 py-6 pb-16">
          <header className="admin-header mb-5 flex items-center justify-between rounded-2xl border p-4 text-[#1e293b] shadow-sm">
            <div className="flex items-center gap-4">
              <div aria-hidden="true" className="admin-brand-mark flex h-10 w-10 items-center justify-center rounded-xl">印</div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#8c929b]">Podzimky 2026</p>
                <h1 className="mt-0.5 whitespace-nowrap text-lg font-bold text-[#1f2937] sm:text-xl">Správa hry</h1>
              </div>
            </div>
            <button
              onClick={() => void handleLogout()}
              className="admin-logout inline-flex items-center gap-2 rounded-xl border border-[#e4e7eb] bg-white px-3 py-2 text-sm font-semibold text-[#596273] transition hover:bg-[#f6f7f9]"
            >
              <LogOut size={16} /> Odhlásit
            </button>
          </header>

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

          <div className="mb-4 grid grid-cols-2 gap-2.5 xl:grid-cols-4">
            <div className="admin-metric flex items-center gap-3 rounded-lg bg-[#fffdfa] px-3 py-2.5 shadow-[0_5px_14px_rgba(20,14,11,0.04)]">
              <span className="admin-metric-icon"><AdminIcon name="stations" /></span>
              <div><p className="text-xs font-semibold text-[#716353]">Stanoviště</p><h3 className="text-xl font-bold text-[#201c19]">{gameState.stations.length}</h3></div>
            </div>
            <div className="admin-metric admin-metric-teams flex items-center gap-3 rounded-lg bg-[#fffdfa] px-3 py-2.5 shadow-[0_5px_14px_rgba(20,14,11,0.04)]">
              <span className="admin-metric-icon"><AdminIcon name="teams" /></span>
              <div><p className="text-xs font-semibold text-[#716353]">Týmy</p><h3 className="text-xl font-bold text-[#201c19]">{gameState.teams.length}</h3></div>
            </div>
            <div className="admin-metric admin-metric-review flex items-center gap-3 rounded-lg bg-[#fffdfa] px-3 py-2.5 shadow-[0_5px_14px_rgba(20,14,11,0.04)]">
              <span className="admin-metric-icon"><AdminIcon name="review" /></span>
              <div><p className="text-xs font-semibold text-[#716353]">Ke schválení</p><h3 className="text-xl font-bold text-[#201c19]">{pendingSubmissions.length}</h3></div>
            </div>
            <div className="admin-metric admin-metric-flash flex items-center gap-3 rounded-lg bg-[#fffdfa] px-3 py-2.5 shadow-[0_5px_14px_rgba(20,14,11,0.04)]">
              <span className="admin-metric-icon"><AdminIcon name="flash" /></span>
              <div><p className="text-xs font-semibold text-[#716353]">Přepady</p><h3 className="text-xl font-bold text-[#201c19]">{gameState.flashMissions.length}</h3></div>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-[190px_minmax(0,1fr)]">
            <aside id="admin-navigation" className="admin-nav h-fit rounded-xl border border-[#e2d8c7] bg-[#fffdfa] p-2 shadow-[0_6px_18px_rgba(25,19,12,0.04)] lg:sticky lg:top-4">
              <button
                type="button"
                className="admin-menu-toggle"
                aria-expanded={isAdminMenuOpen}
                aria-controls="admin-navigation-items"
                onClick={() => setIsAdminMenuOpen((open) => !open)}
              >
                {isAdminMenuOpen ? <X size={17} /> : <Menu size={17} />}
                <span>Herní správa</span>
                {isAdminMenuOpen ? <span className="admin-menu-current">{adminTab === "overview" ? "Přehled" : adminTab === "teams" ? "Týmy" : adminTab === "stations" ? "Stanoviště" : adminTab === "submissions" ? "Schvalování" : adminTab === "media" ? "Galerie" : "Přepady"}</span> : null}
              </button>
              <p className="admin-nav-label px-2 pb-2 pt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[#88775e]">Herní správa</p>
              <nav id="admin-navigation-items" aria-label="Správa hry" className={classNames("admin-nav-items grid grid-cols-2 gap-1 lg:block lg:space-y-1", !isAdminMenuOpen && "admin-nav-items-collapsed")}>
                {[
                  { key: "overview", label: "Přehled", icon: "overview" as const },
                  { key: "teams", label: "Týmy", icon: "teams" as const },
                  { key: "stations", label: "Stanoviště", icon: "stations" as const },
                  { key: "submissions", label: "Schvalování", icon: "review" as const, count: pendingSubmissions.length },
                  { key: "media", label: "Galerie", icon: "media" as const, count: mediaSubmissions.length },
                  { key: "flash", label: "Přepady", icon: "flash" as const, count: gameState.flashMissions.length },
                ].map((item) => (
                  <button
                    key={item.key}
                    onClick={() => {
                      setAdminTab(item.key as typeof adminTab);
                      setIsAdminMenuOpen(false);
                    }}
                    aria-current={adminTab === item.key ? "page" : undefined}
                    className={classNames(
                      "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-semibold transition",
                      adminTab === item.key
                        ? "bg-[#312d27] text-white"
                        : "text-[#4d453a] hover:bg-[#f3eee5]",
                    )}
                  >
                    <AdminIcon name={item.icon} />
                    <span className="flex-1">{item.label}</span>
                    {item.count !== undefined && (
                      <span className={classNames(
                        "rounded-full px-2 py-0.5 text-xs",
                        adminTab === item.key ? "bg-white/15 text-white" : "bg-[#efe6d7] text-[#675844]",
                      )}>
                        {item.count}
                      </span>
                    )}
                  </button>
                ))}
              </nav>
            </aside>
            <div className="admin-content min-w-0 space-y-5">

          {adminTab === "overview" && (
            <div className="grid gap-3 xl:grid-cols-[1.15fr_0.85fr]">
              <section className="rounded-[24px] bg-[#fffdfa] p-3 shadow-[0_12px_30px_rgba(20,16,14,0.08)]">
                <h2 className="mb-3 text-lg font-bold text-[#201c19]">Postup týmů</h2>
                <div className="space-y-2">
                  {gameState.teams.map((team) => {
                    const completed = team.completedStations.length;
                    const percent = Math.round((completed / Math.max(gameState.stations.length, 1)) * 100);
                    return (
                      <div key={team.id} className="rounded-xl border border-[#e8dcc0] bg-[#faf6ef] px-3 py-2.5">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-black text-[#211d1a]">{team.name}</p>
                            <p className="text-xs text-[#675d53]">{completed} / {gameState.stations.length} stanovišť hotovo</p>
                          </div>
                          <span className="rounded-full bg-[#f2dfb2] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[#7a4e1a]">{percent}%</span>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#efe6d4]">
                          <div className="h-full rounded-full bg-[#7d4d19]" style={{ width: `${percent}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="rounded-[24px] bg-[#fffdfa] p-3 shadow-[0_12px_30px_rgba(20,16,14,0.08)]">
                <h2 className="mb-3 text-lg font-bold text-[#201c19]">K vyřízení</h2>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setAdminTab("submissions")}
                    className="rounded-xl bg-[#fff5dd] p-3 text-left transition hover:bg-[#ffefca]"
                  >
                    <p className="text-sm font-semibold text-[#4f3316]">Důkazy ke schválení</p>
                    <p className="mt-1 text-2xl font-black text-[#201c19]">{pendingSubmissions.length}</p>
                    <span className="mt-2 block text-xs font-semibold text-[#7a5826]">Otevřít schvalování →</span>
                  </button>
                  <button
                    onClick={() => setAdminTab("flash")}
                    className="rounded-xl bg-[#f2f4e8] p-3 text-left transition hover:bg-[#e8edd8]"
                  >
                    <p className="text-sm font-semibold text-[#2e4028]">Aktivní přepady</p>
                    <p className="mt-1 text-2xl font-black text-[#201c19]">{gameState.flashMissions.length}</p>
                    <span className="mt-2 block text-xs font-semibold text-[#4b6244]">Spravovat přepady →</span>
                  </button>
                </div>

                <div className="mt-3 rounded-xl border border-[#ead7a7] bg-[#fffaf2] p-3">
                  <h3 className="text-base font-black text-[#201c19]">Poslední dění</h3>
                  <div className="mt-2 space-y-1">
                    {gameState.events.slice(0, 3).map((event) => (
                      <div key={event.id} className="flex items-start gap-3 border-b border-[#e9dcc0] py-2 last:border-0">
                        <span
                          aria-hidden="true"
                          className={classNames(
                            "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                            event.tone === "success" && "bg-[#4f8a50]",
                            event.tone === "warning" && "bg-[#c58b32]",
                            event.tone === "info" && "bg-[#788397]",
                          )}
                        />
                        <p className="min-w-0 flex-1 text-sm text-[#362f2a]">{event.message}</p>
                        <span className="shrink-0 text-xs text-[#685d51]">
                          {new Date(event.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

              </section>
            </div>
          )}

          {adminTab === "teams" && (
            <section className="rounded-2xl border border-[#e3d9c9] bg-[#fffdfa] p-5 shadow-[0_8px_22px_rgba(25,19,12,0.05)]">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-bold text-[#201c19]">Týmy</h2>
                  <p className="mt-1 text-sm text-[#675d53]">{gameState.teams.length} {gameState.teams.length === 1 ? "tým ve hře" : gameState.teams.length >= 2 && gameState.teams.length <= 4 ? "týmy ve hře" : "týmů ve hře"}</p>
                </div>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {gameState.teams.map((team) => {
                  const completed = team.completedStations.length;
                  const percent = Math.round((completed / Math.max(gameState.stations.length, 1)) * 100);
                  const teamPending = gameState.submissions.filter(
                    (submission) => submission.teamId === team.id && submission.status === "pending",
                  ).length;
                  return (
                    <article key={team.id} className="admin-team-card rounded-xl border border-[#e8dccb] bg-[#faf7f1] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-lg font-bold text-[#211d1a]">{team.name}</h3>
                          <p className="mt-1 text-sm text-[#675d53]">
                            {completed} z {gameState.stations.length} stanovišť
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="rounded-full bg-[#f2dfb2] px-2.5 py-1 text-xs font-bold text-[#7a4e1a]">{percent}%</span>
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
                      </div>
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#efe6d4]">
                        <div className="h-full rounded-full bg-[#7d4d19]" style={{ width: `${percent}%` }} />
                      </div>
                      <p className="mt-3 text-xs text-[#675d53]">
                        {teamPending > 0 ? `${teamPending} úkol čeká na schválení` : team.flashMissionId ? "Má aktivní přepad" : "Bez čekajících úkolů"}
                      </p>
                      <button
                        type="button"
                        onClick={() => void handleGenerateTeamQr(team)}
                        disabled={teamQrBusyId === team.id}
                        className="mt-3 inline-flex items-center gap-2 rounded-lg border border-[#d8c6a2] bg-white px-3 py-2 text-xs font-semibold text-[#553d2d] transition hover:bg-[#f7f0e4] disabled:opacity-60"
                      >
                        <QrCode size={15} />
                        {teamQrBusyId === team.id ? "Vytvářím kód…" : "Vytvořit přihlašovací QR"}
                      </button>
                      {generatedTeamQr?.teamId === team.id && (
                        <div className="mt-3 flex items-center gap-3 rounded-lg border border-[#e5d9c7] bg-white p-3">
                          <QRCodeSVG
                            value={generatedTeamQr.value}
                            size={112}
                            level="Q"
                            marginSize={3}
                            title={`Přihlašovací QR kód týmu ${team.name}`}
                          />
                          <p className="max-w-48 text-xs leading-relaxed text-[#675d53]">
                            Tento kód umožní přihlášení k týmu. Uchovávejte ho bezpečně.
                          </p>
                        </div>
                      )}
                    </article>
                  );
                })}
                {gameState.teams.length === 0 && (
                  <p className="rounded-xl border border-dashed border-[#d9d0c2] p-5 text-sm text-[#716d63] md:col-span-2">
                    Zatím tu nejsou žádné týmy. Přidejte první tým ve formuláři níže.
                  </p>
                )}
              </div>
              <div className="mt-6 grid gap-3 border-t border-[#ece3d5] pt-5 md:grid-cols-[1fr_1fr_auto]">
                <label className="admin-field-label">
                  Název týmu
                <input
                  value={teamFormAdmin.name}
                  onChange={(event) => setTeamFormAdmin((current) => ({ ...current, name: event.target.value }))}
                  placeholder="např. DRAČÍ STRÁŽ"
                  aria-label="Název nového týmu"
                  className="rounded-lg border border-[#d8c6a2] bg-white p-3 text-sm"
                />
                </label>
                <label className="admin-field-label">
                  Heslo
                <input
                  value={teamFormAdmin.password}
                  type="password"
                  onChange={(event) => setTeamFormAdmin((current) => ({ ...current, password: event.target.value }))}
                  placeholder="Alespoň 8 znaků"
                  aria-label="Heslo nového týmu"
                  className="rounded-lg border border-[#d8c6a2] bg-white p-3 text-sm"
                />
                </label>
                <button onClick={handleAddTeam} className="admin-add-team self-end rounded-lg bg-[#a4332b] px-5 py-3 text-sm font-bold text-white">
                  Přidat tým
                </button>
              </div>
              {error && <p className="mt-3 rounded-lg bg-[#fce7e6] px-3 py-2 text-sm text-[#8b2d2d]">{error}</p>}
            </section>
          )}

          {adminTab === "stations" && (
            <section className="rounded-[24px] bg-[#fffdfa] p-3 shadow-[0_12px_30px_rgba(20,16,14,0.08)]">
              <h2 className="mb-3 text-lg font-bold text-[#201c19]">Stanoviště</h2>

              <div className="space-y-2">
                {gameState.stations.map((station) => (
                  <div key={station.id} className="rounded-lg border border-[#e1d4b6] bg-[#faf6ef] px-3 py-2.5">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#f1e4cf] text-xs font-bold text-[#8f3529]">{station.order}</span>
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-bold text-[#201c19]">{station.title}</h3>
                          <p className="font-mono text-xs text-[#756958]">{station.uid}</p>
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
                              if (!downloadStationQrSvg(station.uid, `stanoviste-${station.uid}.svg`)) {
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
              </div>

              <details className="mt-3 rounded-xl border border-[#e6d7ab] bg-[#fffaf1] p-3">
                <summary className="cursor-pointer text-sm font-bold text-[#8f3529]">Přidat nové stanoviště</summary>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <input
                    value={adminStationForm.title}
                    onChange={(event) => setAdminStationForm((current) => ({ ...current, title: event.target.value }))}
                    placeholder="Název stanoviště"
                    className="rounded-xl border border-[#d8c6a2] bg-white p-3 text-sm"
                  />
                  <input
                    value={adminStationForm.uid}
                    onChange={(event) => setAdminStationForm((current) => ({ ...current, uid: event.target.value.toUpperCase().slice(0, 8) }))}
                    maxLength={8}
                    placeholder="8místný UID"
                    className="rounded-xl border border-[#d8c6a2] bg-white p-3 text-sm uppercase"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setAdminStationForm((current) => ({
                        ...current,
                        uid: createUniqueStationUid(gameState.stations),
                      }));
                      setError("");
                    }}
                    className="rounded-xl border border-[#b18a4b] bg-[#f4e5c5] px-4 py-3 text-sm font-bold text-[#5a3c18]"
                  >
                    Vygenerovat UID
                  </button>
                  {isValidUid(adminStationForm.uid) && (
                    <div className="flex flex-wrap items-center gap-4 rounded-xl border border-[#e1d4b6] bg-[#fffaf1] p-3 md:col-span-2">
                      <div className="rounded-lg bg-white p-2">
                        <QRCodeSVG
                          value={adminStationForm.uid}
                          size={152}
                          level="M"
                          marginSize={4}
                          title={`QR kód UID ${adminStationForm.uid}`}
                          data-qr-uid={adminStationForm.uid}
                        />
                      </div>
                      <div>
                        <p className="font-semibold text-[#201c19]">QR kód pro nové stanoviště</p>
                        <p className="mt-1 font-mono text-lg tracking-widest text-[#72501f]">{adminStationForm.uid}</p>
                        <p className="mt-1 max-w-xs text-sm text-[#65574a]">Kód obsahuje stejné UID, které tým po načtení zadá.</p>
                        <button
                          onClick={() => {
                            if (!downloadStationQrSvg(adminStationForm.uid, `stanoviste-${adminStationForm.uid}.svg`)) {
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
                  <input
                    value={adminStationForm.description}
                    onChange={(event) => setAdminStationForm((current) => ({ ...current, description: event.target.value }))}
                    placeholder="Popis"
                    className="rounded-xl border border-[#d8c6a2] bg-white p-3 text-sm md:col-span-2"
                  />
                  <textarea
                    value={adminStationForm.clue}
                    onChange={(event) => setAdminStationForm((current) => ({ ...current, clue: event.target.value }))}
                    placeholder="Nápověda k nalezení tohoto stanoviště"
                    className="min-h-20 rounded-xl border border-[#d8c6a2] bg-white p-3 text-sm md:col-span-2"
                  />
                  <input
                    value={adminStationForm.task}
                    onChange={(event) => setAdminStationForm((current) => ({ ...current, task: event.target.value }))}
                    placeholder="Zadání"
                    className="rounded-xl border border-[#d8c6a2] bg-white p-3 text-sm md:col-span-2"
                  />
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
                </div>
                {error && <p className="mt-3 rounded-xl bg-[#fce7e6] px-3 py-2 text-sm text-[#8b2d2d]">{error}</p>}
                <button
                  onClick={handleAddStation}
                  className="mt-4 w-full rounded-xl bg-[#a4332b] px-4 py-3 text-sm font-bold text-[#fffdf9]"
                >
                  Přidat stanoviště
                </button>
              </details>
            </section>
          )}

          {adminTab === "submissions" && (
            <section className="rounded-[24px] bg-[#fffdfa] p-4 shadow-[0_12px_30px_rgba(20,16,14,0.08)]">
              <h2 className="mb-4 text-xl font-black text-[#201c19]">Schvalování</h2>
              <div className="space-y-3">
                {pendingSubmissions.length === 0 ? (
                  <p className="rounded-2xl bg-[#f5efe8] p-3 text-sm text-[#5e4d3f]">Žádné čekající důkazy.</p>
                ) : (
                  pendingSubmissions.map((submission) => (
                    <div key={submission.id} className="rounded-2xl border border-[#e7d7b4] bg-[#fffaf3] p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-bold text-[#2b2523]">
                          {gameState.teams.find((team) => team.id === submission.teamId)?.name ?? "Tým"}
                        </p>
                        <span className="rounded-full bg-[#f6ddab] px-2 py-1 text-[10px] font-bold tracking-[0.12em] text-[#7c5516]">
                          Čeká
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-[#52473d]">{getStationById(gameState.stations, submission.stationId)?.title}</p>
                      <p className="mt-2 text-xs text-[#6f5a49]">Důkaz: {submission.evidence}</p>
                      {isStoredMediaUrl(submission.mediaUrl) && getStationById(gameState.stations, submission.stationId)?.type === "photo" && (
                        <Image
                          src={submission.mediaUrl}
                          alt={`Fotografie od týmu ${gameState.teams.find((team) => team.id === submission.teamId)?.name ?? ""}`}
                          width={960}
                          height={640}
                          unoptimized
                          className="mt-3 max-h-80 w-full rounded-xl bg-[#f1ece4] object-contain"
                        />
                      )}
                      {isStoredMediaUrl(submission.mediaUrl) && getStationById(gameState.stations, submission.stationId)?.type === "video" && (
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
                  ))
                )}
              </div>
            </section>
          )}

          {adminTab === "media" && (
            <section className="rounded-[24px] bg-[#fffdfa] p-4 shadow-[0_12px_30px_rgba(20,16,14,0.08)]">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-black text-[#201c19]">Galerie důkazů</h2>
                  <p className="mt-1 text-sm text-[#675d53]">{mediaSubmissions.length} odevzdaných fotografií a videí</p>
                </div>
              </div>
              {mediaSubmissions.length === 0 ? (
                <p className="rounded-xl bg-[#f5efe8] p-4 text-sm text-[#5e4d3f]">Zatím nebyly odevzdány žádné fotografie ani videa.</p>
              ) : (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {mediaSubmissions.map((submission) => {
                    const station = getStationById(gameState.stations, submission.stationId);
                    const team = gameState.teams.find((item) => item.id === submission.teamId);
                    const mediaUrl = submission.mediaUrl;
                    if (!isStoredMediaUrl(mediaUrl)) return null;
                    const isPhoto = station?.type === "photo";
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
                              <p className="mt-1 truncate text-xs text-[#6f5a49]">{station?.title ?? "Odstraněné stanoviště"}</p>
                            </div>
                            <span className="shrink-0 rounded-full bg-[#f6ddab] px-2 py-1 text-[10px] font-bold text-[#7c5516]">
                              {submission.status === "pending" ? "Čeká" : submission.status === "approved" ? "Schváleno" : "Zamítnuto"}
                            </span>
                          </div>
                          <p className="mt-2 text-[11px] text-[#806f5b]">
                            {new Date(submission.createdAt).toLocaleString("cs-CZ")}
                          </p>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {adminTab === "flash" && (
            <section className="rounded-[24px] bg-[#fffdfa] p-4 shadow-[0_12px_30px_rgba(20,16,14,0.08)]">
              <h2 className="mb-4 text-xl font-black text-[#201c19]">Přepadový úkol</h2>
              <div className="space-y-3">
                <input
                  value={flashMissionForm.title}
                  onChange={(event) => setFlashMissionForm((current) => ({ ...current, title: event.target.value }))}
                  placeholder="Název přepadového úkolu"
                  className="w-full rounded-xl border border-[#d8c6a2] bg-[#faf5ee] p-3 text-sm"
                />
                <textarea
                  value={flashMissionForm.description}
                  onChange={(event) => setFlashMissionForm((current) => ({ ...current, description: event.target.value }))}
                  placeholder="Popis úkolu"
                  className="min-h-[80px] w-full rounded-xl border border-[#d8c6a2] bg-[#faf5ee] p-3 text-sm"
                />
                <select
                  value={flashMissionForm.targets}
                  onChange={(event) => setFlashMissionForm((current) => ({ ...current, targets: event.target.value as "all" | "specific" }))}
                  className="w-full rounded-xl border border-[#d8c6a2] bg-[#faf5ee] p-3 text-sm"
                >
                  <option value="all">Všem týmům</option>
                  <option value="specific">Vybraným týmům</option>
                </select>
                {flashMissionForm.targets === "specific" && (
                  <div className="space-y-2">
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
                  </div>
                )}
                <button
                  onClick={launchFlashMission}
                  className="w-full rounded-2xl bg-[#1d1a17] px-4 py-3 text-base font-bold text-white"
                >
                  Odeslat přepadový úkol
                </button>
              </div>
            </section>
          )}
            </div>
          </div>
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

    </main>
  );
}

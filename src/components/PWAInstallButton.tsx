import React, { useEffect, useState } from 'react';
import { Smartphone, Download, CheckCircle, X, Share } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export const PWAInstallButton: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState<boolean>(false);
  const [isIOS, setIsIOS] = useState<boolean>(false);
  const [showIOSModal, setShowIOSModal] = useState<boolean>(false);

  useEffect(() => {
    // Check if app is already running in standalone/installed mode
    if (typeof window !== 'undefined') {
      const isStandalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true;
      setIsInstalled(isStandalone);

      // Detect iOS Safari
      const ua = window.navigator.userAgent.toLowerCase();
      const isIOSDevice = /iphone|ipad|ipod/.test(ua);
      const isSafari = /safari/.test(ua) && !/chrome|crios|fxios/.test(ua);
      setIsIOS(isIOSDevice && isSafari && !isStandalone);

      const handleBeforeInstallPrompt = (e: Event) => {
        // Prevent default mini-infobar from appearing on mobile
        e.preventDefault();
        // Stash the event so it can be triggered later.
        setDeferredPrompt(e as BeforeInstallPromptEvent);
      };

      const handleAppInstalled = () => {
        setIsInstalled(true);
        setDeferredPrompt(null);
      };

      window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.addEventListener('appinstalled', handleAppInstalled);

      return () => {
        window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        window.removeEventListener('appinstalled', handleAppInstalled);
      };
    }
  }, []);

  // Handle native install prompt
  const handleInstallClick = async () => {
    if (!deferredPrompt) {
      if (isIOS) {
        setShowIOSModal(true);
      }
      return;
    }

    // Show native browser install prompt
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
    }
  };

  // If already installed, hide the button
  if (isInstalled) {
    return null;
  }

  // If beforeinstallprompt was captured OR user is on iOS Safari
  const canInstall = !!deferredPrompt || isIOS;

  if (!canInstall) {
    return null;
  }

  return (
    <>
      <button
        onClick={handleInstallClick}
        type="button"
        className="flex items-center gap-1.5 rounded-lg border border-emerald-500/50 bg-emerald-500/15 px-3 py-2 text-xs font-bold font-mono text-emerald-300 transition-all hover:bg-emerald-500/25 hover:border-emerald-400 hover:text-white shadow-sm cursor-pointer animate-pulse hover:animate-none"
        title="Instalar CAD Viewer como aplicativo nativo no celular ou computador"
      >
        <Smartphone className="h-4 w-4 text-emerald-400" />
        <span className="hidden sm:inline">Instalar Aplicativo</span>
        <span className="sm:hidden">Instalar</span>
      </button>

      {/* iOS Installation Guide Modal */}
      {showIOSModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-sm rounded-xl border border-slate-700 bg-[#121822] p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-mono text-sm font-bold text-white flex items-center gap-2">
                <Smartphone className="h-4 w-4 text-emerald-400" />
                Instalar no iPhone / iPad
              </h3>
              <button
                onClick={() => setShowIOSModal(false)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3 font-mono text-xs text-slate-300">
              <p className="text-slate-400">
                Para instalar o <strong>CAD Viewer</strong> no iOS:
              </p>
              <div className="flex items-start gap-2.5 rounded-lg bg-slate-900/90 p-3 border border-slate-800">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-[10px] font-bold text-emerald-400">
                  1
                </span>
                <span className="leading-relaxed">
                  Toque no botão <strong className="text-white flex items-center gap-1 inline-flex"><Share className="h-3.5 w-3.5 text-sky-400" /> Compartilhar</strong> na barra de navegação do Safari.
                </span>
              </div>
              <div className="flex items-start gap-2.5 rounded-lg bg-slate-900/90 p-3 border border-slate-800">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-[10px] font-bold text-emerald-400">
                  2
                </span>
                <span className="leading-relaxed">
                  Role a lista e selecione <strong className="text-white">Adicionar à Tela de Início</strong>.
                </span>
              </div>
            </div>

            <button
              onClick={() => setShowIOSModal(false)}
              className="mt-5 w-full rounded-lg bg-emerald-400 py-2 font-mono text-xs font-bold text-slate-950 hover:bg-emerald-300 transition-colors"
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </>
  );
};

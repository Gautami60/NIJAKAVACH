"use client";

import React, { useState } from "react";
import {
  Shield,
  ShieldCheck,
  Search,
  CheckCircle2,
  FileText,
  Lock,
  Eye,
  RefreshCw,
  ExternalLink,
  Fingerprint,
  FileCheck2
} from "lucide-react";

interface CaseItem {
  id: string;
  sourceName: string;
  sourceUrl: string;
  maskedIdentifier: string;
  state: string;
  discoveredAt: string;
  evidenceKey: string;
  evidenceHash: string;
}

const INITIAL_CASES: CaseItem[] = [
  {
    id: "case-01",
    sourceName: "India B2B Contact Directory Alpha",
    sourceUrl: "https://directory-alpha.example.in/listing/ind-98210",
    maskedIdentifier: "+91 98**** *210",
    state: "POTENTIAL_EXPOSURE_DISCOVERED",
    discoveredAt: "2026-10-30 14:22 UTC",
    evidenceKey: "evidence/cases/c101/snapshot-01.enc",
    evidenceHash: "8f480329a1c2be39ef0018ac0194857ef0192837461829304817263548192039"
  },
  {
    id: "case-02",
    sourceName: "National Yellow Pages India Beta",
    sourceUrl: "https://yellowpages-beta.example.in/profile/user-8812",
    maskedIdentifier: "+91 98**** *210",
    state: "MATCH_CONFIRMED",
    discoveredAt: "2026-10-30 11:05 UTC",
    evidenceKey: "evidence/cases/c102/snapshot-02.enc",
    evidenceHash: "3a7bd3e2360a3d29eea436cdfb27d37fee8f67fc6ec50cd4e511665ec10022f0"
  },
  {
    id: "case-03",
    sourceName: "Delhi NCR Marketing Data Hub",
    sourceUrl: "https://ncr-datahub.example.in/leads/telecom-98210",
    maskedIdentifier: "+91 98**** *210",
    state: "REMOVAL_INDEPENDENTLY_VERIFIED",
    discoveredAt: "2026-10-28 09:30 UTC",
    evidenceKey: "evidence/cases/c103/snapshot-03.enc",
    evidenceHash: "c928471029384756102938475610293847561029384756102938475610293847"
  }
];

export default function HomePage() {
  const [phoneNumber, setPhoneNumber] = useState("9876543210");
  const [cases, setCases] = useState<CaseItem[]>(INITIAL_CASES);
  const [selectedEvidence, setSelectedEvidence] = useState<CaseItem | null>(null);
  const [authorisingCase, setAuthorisingCase] = useState<CaseItem | null>(null);
  const [scanActive, setScanActive] = useState(false);

  const normalizedPhone = `+91 ${phoneNumber.slice(0, 5)} ${phoneNumber.slice(5)}`;
  const mockHmac = "8f480329a1c2be...e018a";

  const handleConfirmMatch = (id: string) => {
    setCases(prev =>
      prev.map(c =>
        c.id === id ? { ...c, state: "MATCH_CONFIRMED" } : c
      )
    );
  };

  const handleDismissCase = (id: string) => {
    setCases(prev =>
      prev.map(c =>
        c.id === id ? { ...c, state: "DISMISSED_AS_FALSE_POSITIVE" } : c
      )
    );
  };

  const handleAuthoriseSubmit = (id: string) => {
    setCases(prev =>
      prev.map(c =>
        c.id === id ? { ...c, state: "REQUEST_SUBMITTED" } : c
      )
    );
    setAuthorisingCase(null);
  };

  const handleTriggerScan = () => {
    setScanActive(true);
    setTimeout(() => {
      setScanActive(false);
    }, 2000);
  };

  return (
    <div className="min-h-screen text-slate-100 flex flex-col">
      {/* Top Navigation */}
      <header className="border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-orange-600/20 border border-orange-500/30 text-orange-400">
              <Shield className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-lg tracking-tight">NIJAKAVACH</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-400 border border-orange-500/20 font-medium">
                  निजकवच
                </span>
              </div>
              <p className="text-[11px] text-slate-400">Personal Data Exposure & Removal Platform</p>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs">
            <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              API Mesh: Healthy
            </span>
            <span className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
              <Lock className="w-3.5 h-3.5 text-orange-400" />
              DPDP Act 2023 Aligned
            </span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 py-8 flex-1 w-full space-y-8">
        {/* Core Product Journey Progression Bar */}
        <section className="glass-card rounded-2xl p-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 mb-4">
            <div>
              <h2 className="text-sm font-semibold tracking-wide text-orange-400 uppercase">
                Core Privacy Journey
              </h2>
              <p className="text-xs text-slate-400">
                Transparent, non-bypassable, evidence-first removal lifecycle
              </p>
            </div>
            <div className="text-xs text-slate-400 font-mono">
              Status: <span className="text-emerald-400 font-semibold">Active Surveillance</span>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            {[
              { step: "01", name: "DISCOVER", desc: "Automated scan across permitted sources", active: true },
              { step: "02", name: "REVIEW", desc: "Evaluate evidence & confirm match", active: true },
              { step: "03", name: "AUTHORISE", desc: "Sign statutory DPDP Sec 12 consent", active: true },
              { step: "04", name: "SUBMIT", desc: "Dispatch request via regulated channel", active: true },
              { step: "05", name: "TRACK", desc: "Monitor source acknowledgment & reply", active: true },
              { step: "06", name: "VERIFY", desc: "Independent recheck & relist audit", active: true },
            ].map((s) => (
              <div
                key={s.name}
                className="p-3 rounded-xl border border-slate-800 bg-slate-900/60 flex flex-col justify-between"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-mono text-orange-400/80">{s.step}</span>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-slate-200 tracking-wider">{s.name}</h3>
                  <p className="text-[10px] text-slate-400 mt-1 leading-tight">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Discovery Scanner Card */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="glass-card rounded-2xl p-6 space-y-5 lg:col-span-1">
            <div className="flex items-center gap-2">
              <Search className="w-5 h-5 text-orange-400" />
              <h2 className="font-semibold text-slate-100">Audit Phone Exposure</h2>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Enter your Indian mobile number to trigger an authorized discovery query against indexed public and lawfully accessible directories.
            </p>

            <div className="space-y-3">
              <label className="text-xs text-slate-300 font-medium">Indian Mobile Number</label>
              <div className="relative">
                <span className="absolute left-3.5 top-2.5 text-xs font-mono text-slate-400 font-medium">+91</span>
                <input
                  type="text"
                  maxLength={10}
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, ""))}
                  className="w-full bg-slate-950/80 border border-slate-700 rounded-xl py-2 pl-12 pr-4 text-sm font-mono text-slate-100 focus:outline-none focus:border-orange-500 transition-colors"
                  placeholder="9876543210"
                />
              </div>

              {/* Cryptographic Security Details */}
              <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-[11px] space-y-1.5 font-mono">
                <div className="flex items-center justify-between text-slate-400">
                  <span>E.164 Normal:</span>
                  <span className="text-slate-200">{normalizedPhone}</span>
                </div>
                <div className="flex items-center justify-between text-slate-400">
                  <span>HMAC Index:</span>
                  <span className="text-orange-400 font-mono">{mockHmac}</span>
                </div>
                <div className="flex items-center gap-1 text-[10px] text-emerald-400/90 pt-1 border-t border-slate-800/80">
                  <Lock className="w-3 h-3" />
                  AES-256-GCM Envelope Encryption
                </div>
              </div>

              <button
                onClick={handleTriggerScan}
                disabled={scanActive || phoneNumber.length < 10}
                className="w-full py-2.5 px-4 rounded-xl bg-orange-600 hover:bg-orange-500 text-white font-medium text-xs flex items-center justify-center gap-2 transition-all shadow-lg shadow-orange-600/20 disabled:opacity-50"
              >
                {scanActive ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Scanning Permitted Sources...
                  </>
                ) : (
                  <>
                    <Search className="w-4 h-4" />
                    Trigger Discovery Scan
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Active Exposure Cases Review */}
          <div className="glass-card rounded-2xl p-6 lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-slate-100 flex items-center gap-2">
                  <Fingerprint className="w-5 h-5 text-orange-400" />
                  Discovered Exposure Cases
                </h2>
                <p className="text-xs text-slate-400">
                  Review findings, inspect point-in-time evidence, and authorize lawful removals
                </p>
              </div>
              <span className="text-xs px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700 text-slate-300">
                {cases.length} Total Cases
              </span>
            </div>

            <div className="space-y-3">
              {cases.map((c) => (
                <div
                  key={c.id}
                  className="p-4 rounded-xl border border-slate-800 bg-slate-900/40 glass-card-hover space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-200">{c.sourceName}</h3>
                      <a
                        href={c.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-slate-400 hover:text-orange-400 flex items-center gap-1 mt-0.5"
                      >
                        {c.sourceUrl}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                    <span
                      className={`text-[10px] font-mono px-2.5 py-1 rounded-full border self-start ${
                        c.state === "POTENTIAL_EXPOSURE_DISCOVERED"
                          ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                          : c.state === "MATCH_CONFIRMED"
                          ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                          : c.state === "REQUEST_SUBMITTED"
                          ? "bg-purple-500/10 text-purple-400 border-purple-500/20"
                          : c.state === "REMOVAL_INDEPENDENTLY_VERIFIED"
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          : "bg-slate-800 text-slate-400 border-slate-700"
                      }`}
                    >
                      {c.state.replace(/_/g, " ")}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center justify-between text-xs pt-2 border-t border-slate-800/80 gap-2">
                    <div className="text-slate-400 font-mono text-[11px]">
                      Target: <span className="text-slate-200">{c.maskedIdentifier}</span> · Discovered: {c.discoveredAt}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setSelectedEvidence(c)}
                        className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs flex items-center gap-1.5 transition-colors"
                      >
                        <Eye className="w-3 h-3 text-orange-400" />
                        Inspect Evidence
                      </button>

                      {c.state === "POTENTIAL_EXPOSURE_DISCOVERED" && (
                        <>
                          <button
                            onClick={() => handleConfirmMatch(c.id)}
                            className="px-2.5 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 text-xs transition-colors"
                          >
                            Confirm Match
                          </button>
                          <button
                            onClick={() => handleDismissCase(c.id)}
                            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 text-xs transition-colors"
                          >
                            Dismiss
                          </button>
                        </>
                      )}

                      {c.state === "MATCH_CONFIRMED" && (
                        <button
                          onClick={() => setAuthorisingCase(c)}
                          className="px-3 py-1 rounded-lg bg-orange-600 hover:bg-orange-500 text-white text-xs font-medium flex items-center gap-1.5 transition-colors shadow-sm"
                        >
                          <FileCheck2 className="w-3 h-3" />
                          Authorise Removal (DPDP Sec 12)
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Verification & Relist Surveillance Notice */}
        <section className="glass-card rounded-2xl p-6 border-l-4 border-l-orange-500">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-orange-500/10 text-orange-400 shrink-0">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-slate-100">
                Architectural Principle: Never Treat Submitted Requests as Completed Removals
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                NIJAKAVACH maintains an asynchronous verification loop. A third-party directory reporting removal does not equate to verified removal. Independent source workers recheck endpoints on an exponential schedule ($T+24h$, $T+7d$, $T+30d$). If previously removed personal data reappears, an <code className="text-orange-400 bg-slate-900 px-1 py-0.5 rounded">ExposureRelisted</code> event immediately alerts the consumer and reopens the case.
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* Modal: Evidence Snapshot Inspector */}
      {selectedEvidence && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-orange-400" />
                <h3 className="font-semibold text-slate-100">Immutable Evidence Snapshot</h3>
              </div>
              <button
                onClick={() => setSelectedEvidence(null)}
                className="text-slate-400 hover:text-slate-200 text-sm"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs font-mono">
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                <div>
                  <span className="text-slate-500">Source:</span>
                  <p className="text-slate-200 mt-0.5">{selectedEvidence.sourceName}</p>
                </div>
                <div>
                  <span className="text-slate-500">S3 Storage Key:</span>
                  <p className="text-orange-400 mt-0.5 break-all">{selectedEvidence.evidenceKey}</p>
                </div>
                <div>
                  <span className="text-slate-500">SHA-256 Digest:</span>
                  <p className="text-emerald-400 mt-0.5 break-all">{selectedEvidence.evidenceHash}</p>
                </div>
                <div>
                  <span className="text-slate-500">Captured At:</span>
                  <p className="text-slate-200 mt-0.5">{selectedEvidence.discoveredAt}</p>
                </div>
              </div>
              <p className="text-[11px] text-slate-400 font-sans">
                Evidence snapshots are streamed directly to encrypted object storage. Presigned URLs with 15-minute expirations allow authorized inspection without exposing database storage.
              </p>
            </div>

            <button
              onClick={() => setSelectedEvidence(null)}
              className="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
            >
              Close Inspector
            </button>
          </div>
        </div>
      )}

      {/* Modal: Statutory DPDP Removal Authorisation */}
      {authorisingCase && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-orange-500/30 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <FileCheck2 className="w-5 h-5 text-orange-400" />
                <h3 className="font-semibold text-slate-100">DPDP Act Section 12 Authorisation</h3>
              </div>
              <button
                onClick={() => setAuthorisingCase(null)}
                className="text-slate-400 hover:text-slate-200 text-sm"
              >
                ✕
              </button>
            </div>

            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3 text-xs leading-relaxed text-slate-300">
              <p className="font-semibold text-slate-100">
                Statutory Notice of Correction and Erasure
              </p>
              <p>
                Under Section 12 of India’s Digital Personal Data Protection Act, 2023 (DPDP Act), a Data Principal has the right to demand erasure of personal data that is no longer necessary for the purpose for which it was processed.
              </p>
              <p className="text-slate-400">
                By clicking "Sign & Dispatch", you provide explicit, revocable electronic authorization to NIJAKAVACH to submit a formal erasure demand on your behalf to <strong className="text-orange-400">{authorisingCase.sourceName}</strong>.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setAuthorisingCase(null)}
                className="flex-1 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleAuthoriseSubmit(authorisingCase.id)}
                className="flex-1 py-2 rounded-xl bg-orange-600 hover:bg-orange-500 text-white text-xs font-medium transition-colors shadow-lg shadow-orange-600/25"
              >
                Sign & Dispatch Removal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-slate-950/60 py-6 text-center text-xs text-slate-500">
        <p>© 2026 NIJAKAVACH (निजकवच) — Personal Data Exposure Discovery and Removal Management Platform.</p>
        <p className="mt-1 text-[11px] text-slate-600">
          Complies with the Digital Personal Data Protection Act, 2023 (DPDP Act). Not a caller-ID application or guarantee against spam calls.
        </p>
      </footer>
    </div>
  );
}

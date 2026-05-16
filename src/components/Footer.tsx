import Link from "next/link";

const footerLinks = [
  { label: "이용약관", href: "/terms" },
  { label: "개인정보처리방침", href: "/privacy", bold: true },
  { label: "고객센터", href: "/support" },
  { label: "광고 안내", href: "/ads" },
];

export default function Footer() {
  return (
    <footer className="border-t border-white/5 bg-black/20">
      <div className="mx-auto max-w-7xl px-8 py-8 text-center">
        <div className="mb-4 flex flex-wrap items-center justify-center gap-6">
          {footerLinks.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className={`text-xs uppercase tracking-widest transition-colors hover:text-white ${
                link.bold ? "font-bold text-white/50" : "text-white/20"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </div>
        <p className="text-[10px] uppercase tracking-[0.2em] text-white/15">
          Copyright &copy; 2026 MY ON AIR. All rights reserved.
        </p>
      </div>
    </footer>
  );
}

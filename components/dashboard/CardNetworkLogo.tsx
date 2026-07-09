export default function CardNetworkLogo({ network }: { network: string }) {
  if (network === "visa") {
    return <span className="text-lg font-black italic tracking-wider">VISA</span>;
  }
  if (network === "mastercard") {
    return (
      <span className="flex -space-x-2">
        <span className="h-5 w-5 rounded-full bg-[#eb001b]" />
        <span className="h-5 w-5 rounded-full bg-[#ff5f00]" />
      </span>
    );
  }
  if (network === "amex") {
    return <span className="rounded border border-current/50 px-1 py-0.5 text-[9px] font-black">AMEX</span>;
  }
  return <span className="text-xs font-black uppercase tracking-wider opacity-75">Card</span>;
}

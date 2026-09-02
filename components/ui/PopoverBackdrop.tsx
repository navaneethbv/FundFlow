export default function PopoverBackdrop({
  onClose,
  zIndex = "z-30",
}: Readonly<{
  onClose: () => void;
  zIndex?: string;
}>) {
  return (
    <button
      type="button"
      aria-hidden
      tabIndex={-1}
      onClick={onClose}
      className={`fixed inset-0 ${zIndex} cursor-default`}
    />
  );
}

export default function RouteLoading() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: 2,
        zIndex: 9999,
        background: "linear-gradient(90deg, transparent, #ef4444 45%, #f59e0b 80%, transparent)",
        animation: "reupai-route-bar 0.7s ease-in-out infinite",
      }}
    />
  );
}

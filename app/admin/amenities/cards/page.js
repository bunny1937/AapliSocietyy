import PageClient from "./PageClient";

export const metadata = { title: "Amenity Cards" };

// Server shell only. The screen is a live list with a confirm dialog, so the
// work happens in PageClient; this file exists to keep the route a server
// component like every other admin page in the app.
export default function AmenityCardsPage() {
  return <PageClient />;
}

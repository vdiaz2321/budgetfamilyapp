import { redirect } from "next/navigation";

// Savings merged into /invest as the "Savings & Contributions" tab. Kept as a
// redirect rather than deleted: bookmarks, the mobile tab bar's history, and
// any stale revalidatePath("/savings") callers all still resolve here.
export default function SavingsPage() {
  redirect("/invest?tab=savings");
}

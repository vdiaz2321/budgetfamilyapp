import { redirect } from "next/navigation";

export default function Home() {
  // Budget is the home screen. The (app) layout gates auth/onboarding from here.
  redirect("/budget");
}

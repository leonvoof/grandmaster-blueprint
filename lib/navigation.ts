import {
  Activity, BookOpen, Brain, ChartNoAxesCombined, Flag, ClipboardCheck, Compass,
  Crosshair, GraduationCap, LayoutDashboard, Library, type LucideIcon,
} from "lucide-react";

export type NavItem = { label: string; href: string; icon: LucideIcon };

export const navigation: NavItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Games", href: "/games", icon: Activity },
  { label: "Analysis", href: "/analysis", icon: Crosshair },
  { label: "Openings", href: "/openings", icon: BookOpen },
  { label: "Tactics", href: "/tactics", icon: Brain },
  { label: "Calculation", href: "/calculation", icon: Compass },
  { label: "Strategy", href: "/strategy", icon: GraduationCap },
  { label: "Endgames", href: "/endgames", icon: Flag },
  { label: "OTB Training", href: "/otb-training", icon: ClipboardCheck },
  { label: "Coach", href: "/coach", icon: Library },
  { label: "Progress", href: "/progress", icon: ChartNoAxesCombined },
  { label: "Weakness Report", href: "/weaknesses", icon: Brain },
];

export const pageDetails: Record<string, { title: string; eyebrow: string; description: string; next: string }> = {
  games: { title: "Your games, in one place.", eyebrow: "GAME LIBRARY", description: "Build a searchable record of your serious games and turn each one into a focused lesson.", next: "Import PGN files and connect your Lichess account" },
  analysis: { title: "Understand every critical moment.", eyebrow: "GAME ANALYSIS", description: "Review your decisions with a board, engine evaluations, and notes tied to the position.", next: "Local board review with Stockfish evaluation" },
  openings: { title: "Make your opening knowledge stick.", eyebrow: "OPENING REPERTOIRE", description: "Organize your lines by color, practice recall, and keep your repertoire connected to your own games.", next: "Personal repertoire tree and spaced repetition" },
  tactics: { title: "Train the patterns behind the move.", eyebrow: "TACTICAL TRAINING", description: "Practice calculation with positions selected for your current strengths and recurring mistakes.", next: "Verified puzzle library and session tracking" },
  calculation: { title: "Calculate with a clear process.", eyebrow: "CALCULATION", description: "Work through candidate moves, forcing lines, and position checks before revealing a solution.", next: "Timed calculation journal and review flow" },
  strategy: { title: "Build plans from the position.", eyebrow: "STRATEGY", description: "Study pawn structures, piece placement, and long-term plans using annotated positions.", next: "Structure-based lessons and annotated examples" },
  endgames: { title: "Turn endgame knowledge into results.", eyebrow: "ENDGAME STUDY", description: "Study essential theoretical positions and practice converting practical advantages.", next: "Endgame trainer with tablebase-backed positions" },
  "otb-training": { title: "Prepare for the tournament hall.", eyebrow: "OVER-THE-BOARD", description: "Create a deliberate routine for long games, tournament preparation, and post-round review.", next: "Round preparation checklist and classical game log" },
  coach: { title: "A training plan built around you.", eyebrow: "TRAINING COACH", description: "Turn your games and study time into a practical weekly plan with clear priorities.", next: "Personalized plan using your game history" },
  weaknesses: { title: "Find the patterns worth training.", eyebrow: "PERSONAL CHESS WEAKNESSES", description: "Evidence from your saved, compatible game analysis.", next: "Analyze your games" },
  progress: { title: "See the work add up.", eyebrow: "PROGRESS", description: "Track study consistency, rating history, and the skills you are improving over time.", next: "Progress charts based on recorded sessions and ratings" },
};

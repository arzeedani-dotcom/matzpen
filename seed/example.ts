/** Generic sample data for a fresh copy of the template (home / work / studies). */
import type { SeedSpace } from "./types";

const seed: SeedSpace[] = [
  {
    name: "עבודה",
    color: "indigo",
    view: "kanban",
    tasks: [
      { title: "להכין מצגת לישיבת צוות", priority: "high", status: "in_progress", due: 1 },
      { title: "לענות למיילים של לקוחות", priority: "urgent", status: "new", due: 0 },
      { title: "לעדכן את דוח ההוצאות", priority: "medium", status: "new", due: -2 },
      { title: "לתאם פגישה עם הספק", priority: "medium", status: "on_hold", due: 4, notes: "ממתין לתשובה מהספק" },
      { title: "לסגור את הצעת המחיר", priority: "high", status: "done", due: -1, completedDaysAgo: 1 },
    ],
  },
  {
    name: "בית",
    color: "emerald",
    view: "list",
    tasks: [
      { title: "לקנות חלב ולחם", priority: "medium", status: "new", due: 0 },
      { title: "לשלם ארנונה", priority: "urgent", status: "new", due: 3 },
      { title: "להתקשר לסבתא", priority: "high", status: "new", due: 1 },
      { title: "לתקן את הברז במטבח", priority: "low", status: "new", due: null },
      { title: "להחזיר ספרים לספרייה", priority: "low", status: "done", due: -3, completedDaysAgo: 2 },
    ],
  },
  {
    name: "לימודים",
    color: "amber",
    view: "calendar",
    tasks: [
      { title: "להגיש עבודה בסטטיסטיקה", priority: "urgent", status: "in_progress", due: 2 },
      { title: "לקרוא פרק 4", priority: "medium", status: "new", due: 5 },
      { title: "מבחן אמצע", priority: "high", status: "new", due: 9 },
      { title: "פגישה עם המנחה", priority: "medium", status: "new", due: 12 },
      { title: "להירשם לקורס הבא", priority: "low", status: "new", due: -1 },
    ],
  },
];

export default seed;

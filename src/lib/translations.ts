export type Lang = 'ar' | 'en'

export const translations = {
  // App
  appTitle: { ar: 'نظام إدارة الإجازات والتأخير', en: 'Leave & Tardiness Management System' },
  appShort: { ar: 'إدارة الإجازات', en: 'Leave Manager' },

  // Nav
  dashboard: { ar: 'لوحة المعلومات', en: 'Dashboard' },
  employees: { ar: 'الموظفين', en: 'Employees' },
  leaves: { ar: 'سجل الإجازات', en: 'Leave Records' },
  tardiness: { ar: 'سجل التأخير', en: 'Tardiness Log' },
  calendar: { ar: 'تقويم الإجازات', en: 'Leave Calendar' },
  ranking: { ar: 'ترتيب الالتزام', en: 'Commitment Ranking' },
  reports: { ar: 'تقرير الإجازات', en: 'Leave Reports' },
  settings: { ar: 'الإعدادات', en: 'Settings' },
  logout: { ar: 'تسجيل الخروج', en: 'Logout' },

  // Dashboard KPIs
  totalEmployees: { ar: 'إجمالي الموظفين', en: 'Total Employees' },
  onLeaveToday: { ar: 'في إجازة اليوم', en: 'On Leave Today' },
  avgBalance: { ar: 'متوسط الرصيد', en: 'Avg Balance' },
  monthTardiness: { ar: 'تأخير الشهر', en: 'Month Tardiness' },

  // Dashboard sections
  employeeLeaveSummary: { ar: 'ملخص إجازات الموظفين', en: 'Employee Leave Summary' },
  leaveByType: { ar: 'الإجازات حسب النوع', en: 'Leave by Type' },
  tardinessRanking: { ar: 'ترتيب التأخير', en: 'Tardiness Ranking' },
  deptSummary: { ar: 'ملخص الأقسام', en: 'Department Summary' },
  deptComparison: { ar: 'مقارنة الأقسام', en: 'Department Comparison' },

  // Table headers
  name: { ar: 'الاسم', en: 'Name' },
  department: { ar: 'القسم', en: 'Department' },
  balance: { ar: 'الرصيد', en: 'Balance' },
  used: { ar: 'المستخدم', en: 'Used' },
  remaining: { ar: 'المتبقي', en: 'Remaining' },
  status: { ar: 'الحالة', en: 'Status' },
  actions: { ar: 'إجراءات', en: 'Actions' },
  deduction: { ar: 'الخصم', en: 'Deduction' },
  total: { ar: 'المجموع', en: 'Total' },
  date: { ar: 'التاريخ', en: 'Date' },
  time: { ar: 'الوقت', en: 'Time' },
  notes: { ar: 'ملاحظات', en: 'Notes' },
  delete: { ar: 'حذف', en: 'Delete' },
  days: { ar: 'يوم', en: 'days' },
  minutes: { ar: 'دقائق', en: 'min' },

  // Leave types
  annual: { ar: 'سنوية', en: 'Annual' },
  sick: { ar: 'مرضية', en: 'Sick' },
  emergency: { ar: 'طارئة', en: 'Emergency' },
  unpaid: { ar: 'بدون راتب', en: 'Unpaid' },
  other: { ar: 'أخرى', en: 'Other' },

  // Status
  available: { ar: 'متاح', en: 'Available' },
  onLeave: { ar: 'في إجازة', en: 'On Leave' },
  approved: { ar: 'موافق عليها', en: 'Approved' },
  rejected: { ar: 'مرفوضة', en: 'Rejected' },
  pending: { ar: 'معلقة', en: 'Pending' },
  cancelled: { ar: 'ملغاة', en: 'Cancelled' },

  // Actions
  add: { ar: 'إضافة', en: 'Add' },
  edit: { ar: 'تعديل', en: 'Edit' },
  save: { ar: 'حفظ', en: 'Save' },
  cancel: { ar: 'إلغاء', en: 'Cancel' },
  confirmDelete: { ar: 'تأكيد الحذف', en: 'Confirm Delete' },
  search: { ar: 'بحث بالاسم...', en: 'Search by name...' },
  allDepts: { ar: 'كل الأقسام', en: 'All Departments' },
  loading: { ar: 'جاري التحميل...', en: 'Loading...' },
  noData: { ar: 'لا توجد بيانات', en: 'No data available' },

  // Forms
  addEmployee: { ar: 'إضافة موظف', en: 'Add Employee' },
  editEmployee: { ar: 'تعديل بيانات الموظف', en: 'Edit Employee' },
  addLeave: { ar: 'إضافة إجازة', en: 'Add Leave' },
  addTardiness: { ar: 'إضافة تأخير', en: 'Add Tardiness' },
  employeeCard: { ar: 'بطاقة الموظف', en: 'Employee Card' },
  employeeName: { ar: 'اسم الموظف', en: 'Employee Name' },
  leaveType: { ar: 'نوع الإجازة', en: 'Leave Type' },
  fromDate: { ar: 'من تاريخ', en: 'From Date' },
  toDate: { ar: 'إلى تاريخ', en: 'To Date' },
  daysCount: { ar: 'عدد الأيام', en: 'Days Count' },
  arrivalTime: { ar: 'وقت الحضور', en: 'Arrival Time' },
  lateMinutes: { ar: 'دقائق التأخير', en: 'Late Minutes' },
  selectEmployee: { ar: 'اختر الموظف', en: 'Select Employee' },
  selectType: { ar: 'اختر النوع', en: 'Select Type' },
  leaveBalance: { ar: 'رصيد الإجازات', en: 'Leave Balance' },

  // Employee list columns
  tardinessHHMM: { ar: 'التأخير', en: 'Tardiness' },

  // Reports
  exportCSV: { ar: 'تصدير CSV', en: 'Export CSV' },
  exportExcel: { ar: 'تصدير Excel', en: 'Export Excel' },
  print: { ar: 'طباعة', en: 'Print' },
  leaveSummary: { ar: 'ملخص الإجازات', en: 'Leave Summary' },
  monthlyCalendar: { ar: 'التقويم الشهري', en: 'Monthly Calendar' },
  importExcel: { ar: 'استيراد Excel', en: 'Import Excel' },

  // Settings
  generalSettings: { ar: 'إعدادات عامة', en: 'General Settings' },
  systemSettings: { ar: 'إعدادات النظام', en: 'System Settings' },
  departments: { ar: 'الأقسام', en: 'Departments' },
  holidays: { ar: 'العطلات الرسمية', en: 'Public Holidays' },
  yearStart: { ar: 'بداية السنة', en: 'Year Start' },
  yearEnd: { ar: 'نهاية السنة', en: 'Year End' },
  annualBalance: { ar: 'رصيد الإجازات السنوي', en: 'Annual Leave Balance' },
  deductionPerHour: { ar: 'الخصم لكل ساعة تأخير', en: 'Deduction Per Hour' },
  currency: { ar: 'العملة', en: 'Currency' },
  currencySymbol: { ar: 'رمز العملة', en: 'Currency Symbol' },
  workHoursPerDay: { ar: 'ساعات العمل في اليوم', en: 'Work Hours Per Day' },
  maxAbsent: { ar: 'الحد الأقصى للغياب في نفس القسم', en: 'Max Absent Same Dept' },
  saveSettings: { ar: 'حفظ الإعدادات', en: 'Save Settings' },
  deptManagement: { ar: 'إدارة الأقسام', en: 'Department Management' },
  employeeCount: { ar: 'عدد الموظفين', en: 'Employee Count' },
  newDeptName: { ar: 'اسم القسم الجديد', en: 'New department name' },
  editDept: { ar: 'تعديل القسم', en: 'Edit Department' },
  deptName: { ar: 'اسم القسم', en: 'Department Name' },
  holidayName: { ar: 'اسم العطلة', en: 'Holiday Name' },

  // Notifications
  notifications: { ar: 'التنبيهات', en: 'Notifications' },
  noNotifications: { ar: 'لا توجد تنبيهات', en: 'No notifications' },

  // Ranking
  commitmentRanking: { ar: 'ترتيب الالتزام', en: 'Commitment Ranking' },
  fullRanking: { ar: 'الترتيب الكامل', en: 'Full Ranking' },
  score: { ar: 'النتيجة', en: 'Score' },
  lateCount: { ar: 'مرات التأخير', en: 'Late Count' },
  excellent: { ar: 'ممتاز', en: 'Excellent' },
  good: { ar: 'جيد', en: 'Good' },
  needsImprovement: { ar: 'يحتاج تحسين', en: 'Needs Improvement' },

  // Toasts
  addedSuccess: { ar: 'تم الإضافة بنجاح', en: 'Added successfully' },
  updatedSuccess: { ar: 'تم التعديل بنجاح', en: 'Updated successfully' },
  deletedSuccess: { ar: 'تم الحذف بنجاح', en: 'Deleted successfully' },
  savedSuccess: { ar: 'تم الحفظ بنجاح', en: 'Saved successfully' },
  error: { ar: 'حدث خطأ', en: 'An error occurred' },
  fillRequired: { ar: 'يرجى ملء جميع الحقول المطلوبة', en: 'Please fill all required fields' },

  // Login
  login: { ar: 'تسجيل الدخول', en: 'Login' },
  loginSubtitle: { ar: 'تسجيل الدخول للمتابعة', en: 'Sign in to continue' },
  username: { ar: 'اسم المستخدم', en: 'Username' },
  password: { ar: 'كلمة المرور', en: 'Password' },
  enterUsername: { ar: 'أدخل اسم المستخدم', en: 'Enter username' },
  enterPassword: { ar: 'أدخل كلمة المرور', en: 'Enter password' },
  loggingIn: { ar: 'جاري تسجيل الدخول...', en: 'Logging in...' },

  // Apply leave
  applyLeave: { ar: 'طلب إجازة', en: 'Apply for Leave' },
  applyLeaveSubtitle: { ar: 'قم بتعبئة النموذج لتقديم طلب إجازة', en: 'Fill the form to submit a leave request' },
  submitRequest: { ar: 'تقديم الطلب', en: 'Submit Request' },
  submitting: { ar: 'جاري التقديم...', en: 'Submitting...' },
  requestSubmitted: { ar: 'تم تقديم الطلب بنجاح', en: 'Request submitted successfully' },
  requestReview: { ar: 'سيتم مراجعة طلبك من قبل الإدارة', en: 'Your request will be reviewed by management' },
  newRequest: { ar: 'تقديم طلب جديد', en: 'Submit new request' },

  // Validation
  endDateAfterStart: { ar: 'تاريخ الانتهاء يجب أن يكون بعد تاريخ البداية', en: 'End date must be after start date' },
  arrivalAfterStart: { ar: 'وقت الحضور يجب أن يكون بعد 08:00', en: 'Arrival time must be after 08:00' },

  // Placeholders
  optionalNotes: { ar: 'ملاحظات اختيارية...', en: 'Optional notes...' },
  enterEmployeeName: { ar: 'أدخل اسم الموظف', en: 'Enter employee name' },
  addNotes: { ar: 'أضف أي ملاحظات...', en: 'Add any notes...' },

  // Misc
  selectedEmployees: { ar: 'تم اختيار', en: 'Selected' },
  employeeUnit: { ar: 'موظف', en: 'employees' },

  // Confirm dialog
  deleteEmployee: { ar: 'حذف موظف', en: 'Delete Employee' },
  deleteLeave: { ar: 'حذف إجازة', en: 'Delete Leave' },
  deleteTardiness: { ar: 'حذف سجل تأخير', en: 'Delete Tardiness Record' },
  deleteDept: { ar: 'حذف قسم', en: 'Delete Department' },
  deleteHoliday: { ar: 'حذف عطلة', en: 'Delete Holiday' },
  areYouSure: { ar: 'هل أنت متأكد من حذف', en: 'Are you sure you want to delete' },

  // Leave history / Tardiness history tabs
  leaveHistory: { ar: 'سجل الإجازات', en: 'Leave History' },
  tardinessHistory: { ar: 'سجل التأخير', en: 'Tardiness History' },
  noLeaves: { ar: 'لا توجد إجازات', en: 'No leaves' },
  noTardiness: { ar: 'لا يوجد تأخير', en: 'No tardiness records' },
  leaveTypes: { ar: 'أنواع الإجازات', en: 'Leave Types' },
  leaveTypeManagement: { ar: 'إدارة أنواع الإجازات', en: 'Leave Type Management' },
  nameAr: { ar: 'الاسم بالعربية', en: 'Arabic Name' },
  nameEn: { ar: 'الاسم بالإنجليزية', en: 'English Name' },
  color: { ar: 'اللون', en: 'Color' },
  addLeaveType: { ar: 'إضافة نوع', en: 'Add Type' },
  editLeaveType: { ar: 'تعديل نوع الإجازة', en: 'Edit Leave Type' },
  deleteLeaveType: { ar: 'حذف نوع إجازة', en: 'Delete Leave Type' },
  usageCount: { ar: 'مرات الاستخدام', en: 'Usage Count' },

  attendance: { ar: 'سجل الحضور', en: 'Attendance' },
  checkIn: { ar: 'وقت الحضور', en: 'Check In' },
  checkOut: { ar: 'وقت الانصراف', en: 'Check Out' },
  workHours: { ar: 'ساعات العمل', en: 'Work Hours' },
  overtime: { ar: 'إضافي', en: 'Overtime' },
  present: { ar: 'حاضر', en: 'Present' },
  absent: { ar: 'غائب', en: 'Absent' },
  monthlySheet: { ar: 'كشف الحضور الشهري', en: 'Monthly Attendance Sheet' },
  recordAttendance: { ar: 'تسجيل حضور', en: 'Record Attendance' },
  selectMonth: { ar: 'اختر الشهر', en: 'Select Month' },
  salaryReport: { ar: 'تقرير الخصومات', en: 'Deduction Report' },
  baseSalary: { ar: 'الراتب الأساسي', en: 'Base Salary' },
  totalDeduction: { ar: 'إجمالي الخصم', en: 'Total Deduction' },
  netImpact: { ar: 'صافي التأثير', en: 'Net Impact' },
  leavePlanner: { ar: 'مخطط الإجازات', en: 'Leave Planner' },
  planned: { ar: 'مخطط', en: 'Planned' },
  taken: { ar: 'مأخوذة', en: 'Taken' },
  fiscalYear: { ar: 'السنة المالية', en: 'Fiscal Year' },
  automation: { ar: 'الأتمتة', en: 'Automation' },
  runDailyProcess: { ar: 'تشغيل المعالجة اليومية', en: 'Run Daily Process' },
  yearlyReset: { ar: 'إعادة تعيين سنوية', en: 'Yearly Reset' },
  autoAbsent: { ar: 'تسجيل غياب تلقائي', en: 'Auto-mark Absent' },
  autoTardiness: { ar: 'تسجيل تأخير تلقائي', en: 'Auto-create Tardiness' },
  resetBalance: { ar: 'إعادة تعيين الرصيد', en: 'Reset Balance' },
  processDate: { ar: 'تاريخ المعالجة', en: 'Process Date' },
  absentMarked: { ar: 'تم تسجيل غياب', en: 'Absent marked' },
  tardinessCreated: { ar: 'تم تسجيل تأخير', en: 'Tardiness created' },
  runProcess: { ar: 'تشغيل', en: 'Run' },
  confirmReset: { ar: 'هل أنت متأكد؟ سيتم إعادة تعيين رصيد جميع الموظفين وتحديث السنة المالية.', en: 'Are you sure? This will reset all employee balances and advance the fiscal year.' },
  lastRun: { ar: 'آخر تشغيل', en: 'Last run' },
  checkInPage: { ar: 'تسجيل الحضور والانصراف', en: 'Attendance Check-in' },
  checkInSubtitle: { ar: 'اختر اسمك وسجل حضورك أو انصرافك', en: 'Select your name and check in or out' },
  checkInBtn: { ar: 'تسجيل حضور', en: 'Check In' },
  checkOutBtn: { ar: 'تسجيل انصراف', en: 'Check Out' },
  checkedInAt: { ar: 'تم تسجيل الحضور في', en: 'Checked in at' },
  checkedOutAt: { ar: 'تم تسجيل الانصراف في', en: 'Checked out at' },
  alreadyCheckedIn: { ar: 'تم تسجيل حضورك مسبقاً', en: 'Already checked in' },
  alreadyCheckedOut: { ar: 'تم تسجيل انصرافك مسبقاً', en: 'Already checked out' },
  notCheckedIn: { ar: 'لم يتم تسجيل الحضور بعد', en: 'Not checked in yet' },
  todayStatus: { ar: 'حالة اليوم', en: "Today's Status" },
  workedHours: { ar: 'ساعات العمل', en: 'Hours Worked' },
  selectYourName: { ar: 'اختر اسمك', en: 'Select your name' },
  checkMyRequests: { ar: 'متابعة طلباتي', en: 'Check My Requests' },
  myRequests: { ar: 'طلباتي', en: 'My Requests' },
  noRequests: { ar: 'لا توجد طلبات', en: 'No requests' },
  backToForm: { ar: 'العودة للنموذج', en: 'Back to form' },
  requestDate: { ar: 'تاريخ الطلب', en: 'Request Date' },
  emailNotification: { ar: 'إشعار بالبريد', en: 'Email Notification' },
  emailSent: { ar: 'تم إرسال الإشعار', en: 'Notification sent' },
  emailSettings: { ar: 'إعدادات البريد', en: 'Email Settings' },
  workStartTime: { ar: 'وقت بداية العمل', en: 'Work Start Time' },
  workDays: { ar: 'أيام العمل', en: 'Working Days' },
  sunday: { ar: 'الأحد', en: 'Sunday' },
  monday: { ar: 'الإثنين', en: 'Monday' },
  tuesday: { ar: 'الثلاثاء', en: 'Tuesday' },
  wednesday: { ar: 'الأربعاء', en: 'Wednesday' },
  thursday: { ar: 'الخميس', en: 'Thursday' },
  friday: { ar: 'الجمعة', en: 'Friday' },
  saturday: { ar: 'السبت', en: 'Saturday' },
  scheduleNote: { ar: 'تغيير ساعات العمل يؤثر على حساب التأخير والرصيد. مثال: في رمضان غيّر إلى 6 ساعات.', en: 'Changing work hours affects tardiness and balance calculations. Example: set to 6 hours during Ramadan.' },

  // Overtime report
  overtimeReport: { ar: 'تقرير الإضافي', en: 'Overtime Report' },

  // Excused tardiness
  excused: { ar: 'مستأذن', en: 'Excused' },
  excusedTardiness: { ar: 'تأخير مستأذن', en: 'Excused Tardiness' },

  // Employee Portal - My Info
  myInfo: { ar: 'معلوماتي', en: 'My Info' },
  leaveBalanceRemaining: { ar: 'الرصيد المتبقي', en: 'Remaining Balance' },
  leaveUsed: { ar: 'الإجازات المستخدمة', en: 'Leave Used' },
  totalBalance: { ar: 'الرصيد الكلي', en: 'Total Balance' },
  personalInfo: { ar: 'المعلومات الشخصية', en: 'Personal Information' },

  // Employee Portal - My Records
  myRecords: { ar: 'سجلاتي', en: 'My Records' },
  attendanceHistory: { ar: 'سجل الحضور', en: 'Attendance History' },
  noAttendance: { ar: 'لا توجد سجلات حضور', en: 'No attendance records' },
  late: { ar: 'متأخر', en: 'Late' },
  recentRecords: { ar: 'آخر السجلات', en: 'Recent Records' },
} as const

export type TranslationKey = keyof typeof translations

export function t(key: TranslationKey, lang: Lang): string {
  return translations[key]?.[lang] || key
}

export function leaveTypeName(lt: { name_ar: string; name_en: string } | undefined | null, lang: Lang): string {
  if (!lt) return ''
  return lang === 'ar' ? lt.name_ar : lt.name_en
}

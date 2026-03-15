import { createContext, useContext, useState, useEffect } from 'react';

const translations = {
  en: {
    // Nav
    schedule: 'Schedule',
    reminders: 'Reminders',
    profile: 'My Profile',
    admin: 'Admin',
    signOut: 'Sign out',
    lightMode: 'Light mode',
    darkMode: 'Dark mode',

    // Login
    signIn: 'Sign in',
    username: 'Username',
    password: 'Password',
    signingIn: 'Signing in…',
    enterCode: 'Enter authenticator code',
    sixDigitCode: '6-digit code',
    verifying: 'Verifying…',
    verify: 'Verify',
    back: '← Back',

    // Notifications
    notifications: 'Notifications',
    markRead: 'Mark read',
    clearAll: 'Clear all',
    allClear: 'All clear',

    // Profile
    myProfile: 'My Profile',
    identity: 'Identity',
    displayName: 'Display name (shown in schedule)',
    nameColor: 'Name color',
    avatarUrl: 'Avatar URL (optional)',
    saveIdentity: 'Save identity',
    timezone: 'Timezone',
    timezoneDesc: 'All notifications and schedule times are adjusted to your timezone.',
    yourTimezone: 'Your timezone',
    currentLocalTime: 'Your current local time',
    saveTimezone: 'Save timezone',
    telegramNotifications: 'Telegram Notifications',
    linked: 'Linked',
    notLinked: 'Not linked',
    telegramUsername: 'Telegram username',
    shiftNotifications: 'Shift notifications',
    reminderNotifications: 'Reminder notifications',
    saveTelegramSettings: 'Save telegram settings',
    getLinkCode: 'Get link code',

    // Admin
    adminPanel: 'Admin Panel',
    users: 'Users',
    groups: 'Groups',
    shiftConfig: 'Shift Config',
    telegram: 'Telegram',
    notificationsTab: 'Notifications',
    logs: 'Logs',
    addUser: '+ Add user',
    allActions: 'All actions',
    noLogEntries: 'No log entries',
    noLogEntriesDesc: 'Actions will appear here as users interact with the portal',

    // Schedule
    schedule_title: 'Schedule',
    week: 'Week',
    month: 'Month',
    today: 'Today',
    timeOff: 'Time off',
    addShift: '+ Shift',
    generate: '⚡ Generate',
    publish: 'Publish',
    timeOffRequests: 'Time-off requests',
    noRequests: 'No requests',
    generateSchedule: 'Generate Schedule',
    start: 'Start',
    end: 'End',
    shiftTypes: 'Shift types',
    cancel: 'Cancel',
    addShiftManually: 'Add Shift Manually',
    engineer: 'Engineer',
    date: 'Date',
    shiftType: 'Shift type',
    location: 'Location',
    add: 'Add',
    requestTimeOff: 'Request Time Off',
    type: 'Type',
    comment: 'Comment',
    submit: 'Submit',
    dayOff: 'Day off',
    vacation: 'Vacation',
    sickLeave: 'Sick leave',

    // Reminders
    reminders_title: 'Reminders',
    active: 'Active',
    all: 'All',
    newReminder: '+ New',
    noReminders: 'No reminders',
    noRemindersDesc: 'Create one to get started',
    cancelReminder: 'Cancel',
    newReminderTitle: 'New Reminder',
    title: 'Title',
    description: 'Description',
    quickSet: 'Quick set',
    remindAt: 'Remind at',
    recurring: 'Recurring',
    telegram: 'Telegram',
    create: 'Create',
    tomorrow: 'Tomorrow',

    // OTP
    twoFactor: 'Two-Factor Authentication',
    twoFactorDesc: 'Protect your account with an authenticator app (Google Authenticator, Authy, etc.).',
    otpActive: '2FA enabled',
    otpInactive: '2FA disabled',
    setupOtp: 'Set up 2FA',
    otpScanQr: 'Scan this QR code with your authenticator app, then enter the 6-digit code to confirm.',
    otpManualKey: 'Manual key',
    otpEnterCode: '6-digit code',
    otpConfirm: 'Confirm & enable',
    otpEnabled: '2FA enabled successfully',
    otpDisable: 'Disable 2FA',
    otpDisableDesc: 'Enter your current authenticator code to disable 2FA.',
    otpDisabled: '2FA has been disabled',

    // Common
    failedToLoad: 'Failed to load profile. Please refresh.',
    loading: 'Loading…',
    select: 'Select…',
    inOffice: 'In Office',
    remote: 'Remote',
    draft: 'draft',
    danger: 'danger',
  },
  ru: {
    // Nav
    schedule: 'Расписание',
    reminders: 'Напоминания',
    profile: 'Мой профиль',
    admin: 'Админ',
    signOut: 'Выйти',
    lightMode: 'Светлая тема',
    darkMode: 'Тёмная тема',

    // Login
    signIn: 'Войти',
    username: 'Логин',
    password: 'Пароль',
    signingIn: 'Вход…',
    enterCode: 'Введите код из приложения',
    sixDigitCode: '6-значный код',
    verifying: 'Проверка…',
    verify: 'Подтвердить',
    back: '← Назад',

    // Notifications
    notifications: 'Уведомления',
    markRead: 'Прочитать',
    clearAll: 'Очистить',
    allClear: 'Всё прочитано',

    // Profile
    myProfile: 'Мой профиль',
    identity: 'Данные',
    displayName: 'Отображаемое имя (видно в расписании)',
    nameColor: 'Цвет имени',
    avatarUrl: 'URL аватара (необязательно)',
    saveIdentity: 'Сохранить',
    timezone: 'Часовой пояс',
    timezoneDesc: 'Все уведомления и время смен отображаются в вашем часовом поясе.',
    yourTimezone: 'Ваш часовой пояс',
    currentLocalTime: 'Текущее местное время',
    saveTimezone: 'Сохранить пояс',
    telegramNotifications: 'Уведомления Telegram',
    linked: 'Привязан',
    notLinked: 'Не привязан',
    telegramUsername: 'Telegram логин',
    shiftNotifications: 'Уведомления о сменах',
    reminderNotifications: 'Уведомления напоминаний',
    saveTelegramSettings: 'Сохранить настройки',
    getLinkCode: 'Получить код привязки',

    // Admin
    adminPanel: 'Панель администратора',
    users: 'Пользователи',
    groups: 'Группы',
    shiftConfig: 'Конфиг смен',
    telegram: 'Telegram',
    notificationsTab: 'Уведомления',
    logs: 'Журнал',
    addUser: '+ Добавить',
    allActions: 'Все действия',
    noLogEntries: 'Нет записей',
    noLogEntriesDesc: 'Действия будут появляться по мере использования портала',

    // Schedule
    schedule_title: 'Расписание',
    week: 'Неделя',
    month: 'Месяц',
    today: 'Сегодня',
    timeOff: 'Отгул',
    addShift: '+ Смена',
    generate: '⚡ Генерировать',
    publish: 'Опубликовать',
    timeOffRequests: 'Заявки на отгул',
    noRequests: 'Заявок нет',
    generateSchedule: 'Генерация расписания',
    start: 'Начало',
    end: 'Конец',
    shiftTypes: 'Типы смен',
    cancel: 'Отмена',
    addShiftManually: 'Добавить смену вручную',
    engineer: 'Инженер',
    date: 'Дата',
    shiftType: 'Тип смены',
    location: 'Место',
    add: 'Добавить',
    requestTimeOff: 'Запрос отгула',
    type: 'Тип',
    comment: 'Комментарий',
    submit: 'Отправить',
    dayOff: 'Выходной',
    vacation: 'Отпуск',
    sickLeave: 'Больничный',

    // Reminders
    reminders_title: 'Напоминания',
    active: 'Активные',
    all: 'Все',
    newReminder: '+ Создать',
    noReminders: 'Нет напоминаний',
    noRemindersDesc: 'Создайте первое напоминание',
    cancelReminder: 'Отменить',
    newReminderTitle: 'Новое напоминание',
    title: 'Заголовок',
    description: 'Описание',
    quickSet: 'Быстрый выбор',
    remindAt: 'Напомнить в',
    recurring: 'Повторять',
    telegram: 'Telegram',
    create: 'Создать',
    tomorrow: 'Завтра',

    // OTP
    twoFactor: 'Двухфакторная аутентификация',
    twoFactorDesc: 'Защитите аккаунт с помощью приложения (Google Authenticator, Authy и др.).',
    otpActive: '2FA включена',
    otpInactive: '2FA отключена',
    setupOtp: 'Настроить 2FA',
    otpScanQr: 'Отсканируйте QR-код в приложении-аутентификаторе, затем введите 6-значный код для подтверждения.',
    otpManualKey: 'Ручной ключ',
    otpEnterCode: '6-значный код',
    otpConfirm: 'Подтвердить и включить',
    otpEnabled: '2FA успешно включена',
    otpDisable: 'Отключить 2FA',
    otpDisableDesc: 'Введите код из приложения для отключения 2FA.',
    otpDisabled: '2FA отключена',

    // Common
    failedToLoad: 'Не удалось загрузить профиль. Обновите страницу.',
    loading: 'Загрузка…',
    select: 'Выбрать…',
    inOffice: 'В офисе',
    remote: 'Удалённо',
    draft: 'черновик',
  },
};

const LangContext = createContext();

export function LangProvider({ children }) {
  const [lang, setLang] = useState(() => localStorage.getItem('lang') || 'en');

  useEffect(() => { localStorage.setItem('lang', lang); }, [lang]);

  const toggle = () => setLang(l => l === 'en' ? 'ru' : 'en');
  const t = key => translations[lang]?.[key] ?? translations.en[key] ?? key;

  return (
    <LangContext.Provider value={{ lang, toggle, t }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang() { return useContext(LangContext); }

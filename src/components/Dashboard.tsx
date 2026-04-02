import React, { useEffect, useState, useMemo, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Badge } from './ui/badge';
import { Button, buttonVariants } from './ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { ScrollArea } from './ui/scroll-area';
import { Separator } from './ui/separator';
import { toast } from 'sonner';
import { Play, Database, RefreshCw, AlertCircle, CheckCircle2, Clock, ExternalLink, Activity, Search, ChevronLeft, ChevronRight, FileText, Download, Settings, ShieldCheck, Server, Terminal, ListFilter, Sparkles, Moon, Sun, BookOpen, Eye, X, Cloud, AlertTriangle, XCircle, Pencil, Code, Zap } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Label } from './ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from './ui/alert-dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from"@google/genai";
import { useTheme } from 'next-themes';
// Dashboard.css import removed as styles are now in index.css

interface SyncRun {
 id: string;
 timestamp: string;
 status: string;
 totalFilesGenerated: number;
 totalItemsParsed: number;
 errorSummary: string | null;
 triggerType: string;
}

interface SourceMetric {
 id: string;
 sourceName: string;
 sourceUrl: string;
 lastSyncTimestamp: string;
 itemsParsedLastSync: number;
 healthStatus: string;
 lastErrorMessage: string | null;
 lastTriggerType: string | null;
}

interface AppLog {
 id: string;
 timestamp: string;
 level: string;
 message: string;
 syncRunId: string | null;
 metadata: string | null;
}

interface OutputFile {
 name: string;
 size: number;
 lastModified: string;
}

export default function Dashboard() {
 const { theme, setTheme } = useTheme();
 const [runs, setRuns] = useState<SyncRun[]>([]);
 const [syncRunsPage, setSyncRunsPage] = useState(1);
 const [syncRunsTotal, setSyncRunsTotal] = useState(0);
 const [metrics, setMetrics] = useState<SourceMetric[]>([]);
 const [dataSources, setDataSources] = useState<any[]>([]);
 const [files, setFiles] = useState<OutputFile[]>([]);
 const [loading, setLoading] = useState(true);
 const [syncing, setSyncing] = useState(false);
 const [activeTab, setActiveTab] = useState('overview');
 const [readmeContent, setReadmeContent] = useState<string>('');

 // Debug Console State
 const [debugLogs, setDebugLogs] = useState<AppLog[]>([]);
 const [debugPage, setDebugPage] = useState(1);
 const [debugTotal, setDebugTotal] = useState(0);
 const [debugLevel, setDebugLevel] = useState('ALL');
 const [debugSearch, setDebugSearch] = useState('');
 const [debugLoading, setDebugLoading] = useState(false);
 const [selectedLog, setSelectedLog] = useState<AppLog | null>(null);
 const [autoScroll, setAutoScroll] = useState(true);
 const debugScrollRef = useRef<HTMLDivElement>(null);

 // Network Console State
 const [networkLogs, setNetworkLogs] = useState<AppLog[]>([]);
 const [networkPage, setNetworkPage] = useState(1);
 const [networkTotal, setNetworkTotal] = useState(0);
 const [networkSearch, setNetworkSearch] = useState('');
 const [networkLoading, setNetworkLoading] = useState(false);
 const [selectedNetworkLog, setSelectedNetworkLog] = useState<AppLog | null>(null);

 // Run Details State
 const [selectedRun, setSelectedRun] = useState<SyncRun | null>(null);
 const [runLogs, setRunLogs] = useState<AppLog[]>([]);
 const [runLogsLoading, setRunLogsLoading] = useState(false);

 // Gemini Brief State
 const [geminiBrief, setGeminiBrief] = useState<string | null>(null);
 const [geminiLoading, setGeminiLoading] = useState(false);
 const [geminiError, setGeminiError] = useState<string | null>(null);

 // Settings State
 const [settings, setSettings] = useState<Record<string, string>>({});
 const [settingsLoading, setSettingsLoading] = useState(false);
 const [purging, setPurging] = useState(false);
 const [showPurgeDialog, setShowPurgeDialog] = useState(false);
 const [showResetDialog, setShowResetDialog] = useState(false);
 const [sourceToDelete, setSourceToDelete] = useState<string | null>(null);
 const [showAddSourceDialog, setShowAddSourceDialog] = useState(false);
 const [showEditSourceDialog, setShowEditSourceDialog] = useState(false);
 const [newSource, setNewSource] = useState({ name: '', url: '', type: 'rss' });
 const [editingSource, setEditingSource] = useState<any>(null);
 const [systemStatus, setSystemStatus] = useState<any>(null);

 // GCS Export State
 const [isGCSDialogOpen, setIsGCSDialogOpen] = useState(false);
 const [gcsProjectId, setGcsProjectId] = useState('');
 const [gcsBucketName, setGcsBucketName] = useState('');
 const [gcsAuthCode, setGcsAuthCode] = useState('');
 const [isExporting, setIsExporting] = useState(false);

 const handleGCSExport = async () => {
 if (!gcsProjectId || !gcsBucketName || !gcsAuthCode) {
 toast.error('Project ID, Bucket Name, and Auth Code are required');
 return;
 }

 setIsExporting(true);
 try {
 const result = await fetchJson('/api/v1/files-export-gcs', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 projectId: gcsProjectId,
 bucketName: gcsBucketName,
 authCode: gcsAuthCode
 })
 });
 if (result.success) {
 toast.success(result.message);
 setIsGCSDialogOpen(false);
 // Reset form
 setGcsAuthCode('');
 } else {
 toast.error(result.error || 'Export failed');
 }
 } catch (error) {
 toast.error(error instanceof Error ? error.message : 'Failed to export to GCS');
 console.error(error);
 } finally {
 setIsExporting(false);
 }
 };

 const handleDownloadAll = () => {
 window.open('/api/v1/files-download-all', '_blank');
 };

 const exportSyncRunsCsv = () => {
 if (runs.length === 0) return;
 const headers = ['ID', 'Timestamp', 'Status', 'Trigger Type', 'Items Parsed', 'Files Generated', 'Error Summary'];
 const rows = runs.map(r => [
 r.id,
 new Date(r.timestamp).toISOString(),
 r.status,
 r.triggerType,
 r.totalItemsParsed,
 r.totalFilesGenerated,
 r.errorSummary ? `"${r.errorSummary.replace(/"/g, '""')}"` : ''
 ]);
 
 const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
 const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
 const url = URL.createObjectURL(blob);
 const link = document.createElement('a');
 link.setAttribute('href', url);
 link.setAttribute('download', `sync_runs_${new Date().toISOString().split('T')[0]}.csv`);
 document.body.appendChild(link);
 link.click();
 document.body.removeChild(link);
 };

 const fetchJson = async (url: string, options?: RequestInit, retries = 3) => {
 let lastError: any;
 for (let i = 0; i < retries; i++) {
 try {
 const res = await fetch(url, options);
 
 // Handle rate limiting (429) with exponential backoff
 if (res.status === 429) {
 const delay = Math.pow(2, i) * 2000;
 await new Promise(resolve => setTimeout(resolve, delay));
 continue;
 }

 if (!res.ok) {
 const contentType = res.headers.get('content-type');
 if (contentType && contentType.includes('application/json')) {
 const errData = await res.json().catch(() => null);
 throw new Error(errData?.error || `HTTP error! status: ${res.status}`);
 }
 throw new Error(`HTTP error! status: ${res.status}`);
 }

 const contentType = res.headers.get('content-type');
 if (!contentType || !contentType.includes('application/json')) {
 const text = await res.text();
 console.error(`Expected JSON response but received ${contentType || 'unknown content'}:`, text.substring(0, 100));
 throw new Error(`Expected JSON response but received ${contentType || 'unknown content'}. This often happens if the API route is missing or returning an HTML error page.`);
 }

 return await res.json();
 } catch (error) {
 lastError = error;
 // If it's a 429, we already handled it with 'continue'
 // For other errors, we retry unless it's the last attempt
 if (i === retries - 1) throw error;
 await new Promise(resolve => setTimeout(resolve, 1000));
 }
 }
 throw lastError;
 };

 const [analytics, setAnalytics] = useState<any>(null);

 const fetchSystemStatus = async () => {
 try {
 const res = await fetchJson('/api/v1/system/status');
 if (res.success) setSystemStatus(res.data);
 } catch (error) {
 console.error('Failed to fetch system status:', error);
 }
 };

 const fetchSettings = async () => {
 try {
 setSettingsLoading(true);
 const res = await fetchJson('/api/v1/system/settings');
 if (res.success) setSettings(res.data);
 } catch (error) {
 console.error('Failed to fetch settings:', error);
 } finally {
 setSettingsLoading(false);
 }
 };

 const updateSetting = async (key: string, value: string) => {
 try {
 const res = await fetchJson('/api/v1/system/settings', {
 method: 'POST',
 headers: {
 'Content-Type': 'application/json'
 },
 body: JSON.stringify({ key, value })
 });
 if (res.success) {
 toast.success(`Setting ${key} updated`);
 fetchSettings();
 } else {
 toast.error(res.error || 'Failed to update setting');
 }
 } catch (error) {
 toast.error(error instanceof Error ? error.message : 'Failed to update setting');
 }
 };

 const purgeSystem = async () => {
 setShowPurgeDialog(false);
 try {
 setPurging(true);
 const res = await fetchJson('/api/v1/system/purge', {
 method: 'POST'
 });
 if (res.success) {
 toast.success('System purged successfully');
 fetchData();
 fetchSystemStatus();
 fetchDebugLogs();
 fetchNetworkLogs();
 } else {
 toast.error(res.error || 'Failed to purge system');
 }
 } catch (error) {
 toast.error(error instanceof Error ? error.message : 'Failed to purge system');
 } finally {
 setPurging(false);
 }
 };

 const resetSettings = async () => {
 setShowResetDialog(false);
 try {
 const res = await fetchJson('/api/v1/system/reset', {
 method: 'POST'
 });
 if (res.success) {
 toast.success('Settings reset successfully');
 fetchSettings();
 } else {
 toast.error(res.error || 'Failed to reset settings');
 }
 } catch (error) {
 toast.error(error instanceof Error ? error.message : 'Failed to reset settings');
 }
 };

 const fetchData = async () => {
 try {
 const [runsRes, metricsRes, sourcesRes, filesRes, analyticsRes, readmeRes] = await Promise.all([
 fetchJson(`/api/v1/sync-runs?page=${syncRunsPage}&limit=10`),
 fetchJson('/api/v1/source-metrics'),
 fetchJson('/api/v1/sources'),
 fetchJson('/api/v1/files'),
 fetchJson('/api/v1/analytics'),
 fetchJson('/api/v1/readme')
 ]);

 if (runsRes.success) {
 setRuns(runsRes.data);
 setSyncRunsTotal(runsRes.total);
 
 // Check if any run is currently running to update global syncing state
 const isAnyRunning = runsRes.data.some((run: any) => run.status === 'RUNNING');
 if (isAnyRunning) {
 setSyncing(true);
 } else if (!syncing) {
 // Only set to false if we weren't already in a manual trigger state
 // This prevents the button from flickering if the poll happens right after trigger
 setSyncing(false);
 }
 }
 if (metricsRes.success) setMetrics(metricsRes.data);
 if (sourcesRes?.success) setDataSources(sourcesRes.data);
 if (filesRes?.success) setFiles(filesRes.data);
 if (analyticsRes?.success) setAnalytics(analyticsRes.data);
 if (readmeRes?.success) setReadmeContent(readmeRes.content);
 } catch (error) {
 console.error("Fetch error:", error);
 const errorMessage = error instanceof Error ? error.message : String(error);
 toast.error(
 <div className="flex flex-col gap-1">
 <span className="font-semibold">Failed to fetch dashboard data</span>
 <span className="text-sm opacity-90">{errorMessage}</span>
 </div>
 );
 } finally {
 setLoading(false);
 }
 };

 useEffect(() => {
 fetchData();
 const interval = setInterval(fetchData, 2000); // Poll every 2s for live refresh
 return () => clearInterval(interval);
 }, [syncRunsPage]);

 const fetchDebugLogs = async () => {
 setDebugLoading(true);
 try {
 const params = new URLSearchParams({
 page: debugPage.toString(),
 limit: '50',
 excludeLevel: 'NETWORK'
 });
 if (debugLevel !== 'ALL') params.append('level', debugLevel);
 if (debugSearch) params.append('search', debugSearch);
 
 const data = await fetchJson(`/api/v1/logs?${params.toString()}`);
 if (data.success) {
 setDebugLogs(data.data);
 setDebugTotal(data.total);
 }
 } catch (error) {
 console.error("Failed to fetch debug logs:", error);
 } finally {
 setDebugLoading(false);
 }
 };

 const fetchNetworkLogs = async () => {
 setNetworkLoading(true);
 try {
 const params = new URLSearchParams({
 page: networkPage.toString(),
 limit: '50',
 level: 'NETWORK'
 });
 if (networkSearch) params.append('search', networkSearch);
 
 const data = await fetchJson(`/api/v1/logs?${params.toString()}`);
 if (data.success) {
 setNetworkLogs(data.data);
 setNetworkTotal(data.total);
 }
 } catch (error) {
 console.error("Failed to fetch network logs:", error);
 } finally {
 setNetworkLoading(false);
 }
 };

 const fetchRunLogs = async (runId: string) => {
 setRunLogsLoading(true);
 try {
 const data = await fetchJson(`/api/v1/logs?syncRunId=${runId}&limit=1000`);
 if (data.success) {
 setRunLogs(data.data);
 }
 } catch (error) {
 console.error("Failed to fetch run logs:", error);
 toast.error("Failed to fetch logs for this run");
 } finally {
 setRunLogsLoading(false);
 }
 };

 const fetchGeminiBrief = async () => {
 setGeminiLoading(true);
 setGeminiError(null);
 try {
 // Step 1: Fetch the content from the backend
 const data = await fetchJson('/api/v1/gemini/content');
 if (!data.success) {
 throw new Error(data.error || 'Failed to fetch content for brief');
 }

 if (!data.content) {
 setGeminiBrief("No data available yet. Please run a sync first.");
 return;
 }

 // Step 2: Generate the brief using Gemini on the frontend
 const apiKey = process.env.GEMINI_API_KEY;
 if (!apiKey) {
 throw new Error('Gemini API key is not configured in the environment.');
 }

 const ai = new GoogleGenAI({ apiKey });
 
 // Implement retry for Gemini generation to handle 429 errors
 let response;
 let genRetries = 3;
 for (let i = 0; i < genRetries; i++) {
 try {
 response = await ai.models.generateContent({
 model:"gemini-3-flash-preview",
 contents: [
 {
 role:"user",
 parts: [{
 text: `You are an expert data analyst and technical writer. Below is a collection of recent internal data feeds from various sources (AI research, cloud innovation, security bulletins, releases, etc.). 
 
 Your task is to generate a"Weekly Intelligence Brief" that provides a high-impact, actionable summary of the most critical developments from the last week.
 
 Requirements:
 1. Format the output using high-quality, sophisticated Markdown.
 2. Use a professional, authoritative, and concise tone.
 3. Include the following mandatory sections: 
 - **Executive Intelligence Summary**: A high-level overview of the most significant trends.
 - **Critical Security Bulletins**: A detailed table summarizing vulnerabilities, severity levels, and required actions.
 - **Release Notes & Product Updates**: A categorized list of major feature launches and technical improvements.
 - **Product Deprecations & Lifecycle Alerts**: Clearly highlight upcoming deprecations or end-of-life notices.
 - **Strategic Recommendations**: Actionable steps for the engineering and security teams.
 4. Use tables for security data, bolding for emphasis, and nested lists for technical details.
 5. Ensure the formatting is visually impressive and easy to scan.
 6. Focus strictly on the most recent and critical information provided in the feeds.
 7. Use Markdown features like blockquotes for key insights, horizontal rules for section separation, and code blocks for technical snippets or commands.
 8. Add a"Data Sources & Methodology" section at the end.
 
 Data Feeds:
 ${data.content}`
 }]
 }
 ]
 });
 break; // Success, exit retry loop
 } catch (err: any) {
 const isRateLimit = err.message?.includes('429') || err.status === 429;
 if (isRateLimit && i < genRetries - 1) {
 const delay = Math.pow(2, i) * 3000;
 console.warn(`Gemini rate limit hit (429). Retrying in ${delay}ms...`);
 await new Promise(resolve => setTimeout(resolve, delay));
 continue;
 }
 throw err;
 }
 }

 if (response && response.text) {
 setGeminiBrief(response.text);
 } else {
 throw new Error('Gemini returned an empty response.');
 }
 } catch (error) {
 console.error("Failed to generate Gemini brief:", error);
 setGeminiError(error instanceof Error ? error.message : 'Failed to generate brief');
 } finally {
 setGeminiLoading(false);
 }
 };

 const openRunDetails = (run: SyncRun) => {
 setSelectedRun(run);
 setRunLogs([]);
 fetchRunLogs(run.id);
 };

 useEffect(() => {
 const timer = setTimeout(() => {
 fetchDebugLogs();
 }, 300);
 return () => clearTimeout(timer);
 }, [debugPage, debugLevel, debugSearch]);

 useEffect(() => {
 const timer = setTimeout(() => {
 fetchNetworkLogs();
 }, 300);
 return () => clearTimeout(timer);
 }, [networkPage, networkSearch]);

 // Real-time polling for logs when on the debug tab
 useEffect(() => {
 if (activeTab === 'debug') {
 const interval = setInterval(() => {
 fetchDebugLogs();
 fetchNetworkLogs();
 }, 2000);
 return () => clearInterval(interval);
 }
 }, [activeTab, debugPage, debugLevel, debugSearch, networkPage, networkSearch]);

 useEffect(() => {
 if (autoScroll && debugScrollRef.current) {
 const scrollElement = debugScrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
 if (scrollElement) {
 scrollElement.scrollTop = scrollElement.scrollHeight;
 }
 }
 }, [debugLogs, autoScroll]);

 useEffect(() => {
 if (activeTab === 'settings') {
 fetchSettings();
 fetchSystemStatus();
 }
 }, [activeTab]);

 const chartData = useMemo(() => {
 return [...runs].reverse().map(run => ({
 time: new Date(run.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
 items: run.totalItemsParsed,
 status: run.status
 }));
 }, [runs]);

 const triggerSync = async (sourceId?: string, force: boolean = false) => {
 setSyncing(true);
 const endpoint = sourceId ? '/api/v1/sync/targeted' : '/api/v1/sync/monthly';
 const body = sourceId ? JSON.stringify({ sourceId, force }) : JSON.stringify({ triggerType: 'MANUAL', force });
 
 try {
 const res = await fetchJson(endpoint, {
 method: 'POST',
 headers: { 
 'Content-Type': 'application/json'
 },
 body
 });
 
 if (res.success) {
 toast.success(res.message);
 fetchData();
 } else {
 console.error('Sync error details:', res);
 toast.error(
 <div className="flex flex-col gap-1">
 <span className="font-semibold">{res.details || 'Sync failed'}</span>
 <span className="text-sm opacity-90">{res.error}</span>
 </div>,
 { duration: 10000 }
 );
 }
 } catch (error) {
 console.error('Network error triggering sync:', error);
 toast.error(error instanceof Error ? error.message : 'Network error: Failed to trigger sync');
 } finally {
 setSyncing(false);
 }
 };

 const testConnection = async (sourceId: string) => {
 const toastId = toast.loading('Testing connection...');
 try {
 const res = await fetchJson('/api/v1/sync/test', {
 method: 'POST',
 headers: { 
 'Content-Type': 'application/json'
 },
 body: JSON.stringify({ sourceId })
 });
 if (res.success) {
 toast.success(res.message, { id: toastId });
 } else {
 toast.error(res.error || 'Connection test failed', { id: toastId });
 }
 } catch (error) {
 toast.error(error instanceof Error ? error.message : 'Network error during connection test', { id: toastId });
 }
 };

 const getStatusBadge = (status: string) => {
 switch (status) {
 case 'SUCCESS':
 case 'HEALTHY':
 return <Badge variant="outline" className="status-badge status-success"><CheckCircle2 className="w-3 h-3 mr-1" /> {status}</Badge>;
 case 'RUNNING':
 return <Badge variant="outline" className="status-badge status-info"><RefreshCw className="w-3 h-3 mr-1 animate-spin" /> {status}</Badge>;
 case 'PARTIAL_SUCCESS':
 case 'DEGRADED':
 return <Badge variant="outline" className="status-badge status-warning"><AlertCircle className="w-3 h-3 mr-1" /> {status}</Badge>;
 case 'FAILED':
 case 'FAILING':
 case 'ERROR':
 return <Badge variant="outline" className="status-badge status-error"><AlertCircle className="w-3 h-3 mr-1" /> {status}</Badge>;
 case 'INFO':
 return <Badge variant="outline" className="status-badge status-info"><Activity className="w-3 h-3 mr-1" /> {status}</Badge>;
 default:
 return <Badge variant="outline" className="status-badge border-border text-foreground rounded-full">{status}</Badge>;
 }
 };

 const getStatusChip = (status: string) => {
 switch (status) {
 case 'SUCCESS':
 return <span className="status-badge status-success text-[11px] py-0.5"><CheckCircle2 className="w-3 h-3" /> Pass</span>;
 case 'RUNNING':
 return <span className="status-badge status-info text-[11px] py-0.5"><RefreshCw className="w-3 h-3 animate-spin" /> Running</span>;
 case 'PARTIAL_SUCCESS':
 return <span className="status-badge status-warning text-[11px] py-0.5"><AlertTriangle className="w-3 h-3" /> Partial</span>;
 case 'FAILED':
 case 'ERROR':
 return <span className="status-badge status-error text-[11px] py-0.5"><XCircle className="w-3 h-3" /> Fail</span>;
 default:
 return <span className="status-badge border-border text-muted-foreground text-[11px] py-0.5"><Activity className="w-3 h-3" /> {status}</span>;
 }
 };

 return (
 <div className="dashboard-container">
 <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col min-h-screen">
 <header className="dashboard-header">
 <div className="max-w-[1920px] mx-auto w-full flex items-center justify-between">
 <div className="flex items-center gap-4 group cursor-pointer" onClick={() => setActiveTab('overview')}>
 <div className="dashboard-logo-box group-hover:scale-110 transition-transform duration-500">
 <Database className="w-6 h-6 text-[var(--gh-header-fg)]" />
 </div>
 <div className="flex flex-col">
 <div className="flex items-center gap-2">
 <span className="dashboard-title group-hover:opacity-80 transition-opacity">GCP Datanator</span>
 <span className="dashboard-version">v{__APP_VERSION__}</span>
 </div>
 <span className="text-xs font-mono text-[var(--gh-header-muted)]">Enterprise ETL Engine</span>
 </div>
 </div>

 <div className="flex items-center gap-6">
 <div className="hidden md:flex items-center gap-6 text-[13px] font-medium text-[var(--gh-header-muted)] mr-4">
 <Tooltip>
 <TooltipTrigger render={<div className="flex items-center gap-2 hover:text-[var(--gh-header-fg)] transition-colors cursor-pointer" />}>
 <Activity className="w-4 h-4" />
 <span>{analytics?.successRate || 0}% Uptime</span>
 </TooltipTrigger>
 <TooltipContent>System Availability</TooltipContent>
 </Tooltip>
 <Tooltip>
 <TooltipTrigger render={<div className="flex items-center gap-2 hover:text-[var(--gh-header-fg)] transition-colors cursor-pointer" />}>
 <Database className="w-4 h-4" />
 <span>{analytics?.totalItems ? (analytics.totalItems / 1000).toFixed(1) + 'k' : '0'} Records</span>
 </TooltipTrigger>
 <TooltipContent>Total Processed Records</TooltipContent>
 </Tooltip>
 </div>
 <div className="h-8 w-[1px] bg-[var(--gh-header-muted)] opacity-30 hidden md:block" />
 <div className="flex items-center gap-3">
 <Tooltip>
 <TooltipTrigger
 render={
 <Button
 variant="ghost"
 size="icon"
 onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
 className="h-8 w-8 text-[var(--gh-header-muted)] hover:bg-white/10 hover:text-[var(--gh-header-fg)] rounded-md transition-all"
 />
 }
 >
 <Moon className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
 <Sun className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
 </TooltipTrigger>
 <TooltipContent>Toggle {theme === 'dark' ? 'Light' : 'Dark'} Mode</TooltipContent>
 </Tooltip>
 </div>
 </div>
 </div>
 </header>

 {/* Repository Header Style */}
 <div className="bg-muted/30 border-b border-border pt-6">
 <div className="content-container py-0">
 <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-6">
 <div className="space-y-2">
 <div className="flex items-center gap-3 text-xl font-semibold">
 <Database className="w-6 h-6 text-primary" />
 <span className="text-primary hover:text-primary/80 transition-colors cursor-pointer">google-cloud</span>
 <span className="text-muted-foreground/30">/</span>
 <span className="text-foreground hover:text-primary transition-colors cursor-pointer">gcp-datanator</span>
 <Badge variant="outline" className="ml-2 rounded-full text-xs font-medium px-2 py-0.5 border-primary/20 text-primary bg-primary/5">Production</Badge>
 </div>
 <p className="text-muted-foreground text-sm max-w-2xl">
 High-performance ETL pipeline for Google Cloud technical intelligence. Automated synthesis and high-density data lake management.
 </p>
 </div>
 <div className="flex items-center gap-3">
 <Button 
 onClick={() => triggerSync(undefined, true)} 
 disabled={syncing}
 className="github-btn github-btn-primary"
 >
 {syncing ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
 {syncing ? 'Syncing Pipeline...' : 'Trigger Sync Cycle'}
 </Button>
 </div>
 </div>

 <TabsList className="nav-tabs-list">
 <TabsTrigger value="overview">
 <BookOpen className="w-4 h-4" />
 Overview
 </TabsTrigger>
 <TabsTrigger value="gemini">
 <Sparkles className="w-4 h-4" />
 Intelligence
 </TabsTrigger>
 <TabsTrigger value="sources">
 <Activity className="w-4 h-4" />
 Data Sources
 </TabsTrigger>
 <TabsTrigger value="files">
 <FileText className="w-4 h-4" />
 Artifacts
 </TabsTrigger>
 <TabsTrigger value="debug">
 <ShieldCheck className="w-4 h-4" />
 System Logs
 </TabsTrigger>
 <TabsTrigger value="network">
 <Activity className="w-4 h-4" />
 Network
 </TabsTrigger>
 <TabsTrigger value="settings">
 <Settings className="w-4 h-4" />
 Settings
 </TabsTrigger>
 </TabsList>
 </div>
 </div>

 <main className="content-container">
 <AnimatePresence mode="wait">
 <motion.div
 key={activeTab}
 initial={{ opacity: 0, y: 10 }}
 animate={{ opacity: 1, y: 0 }}
 exit={{ opacity: 0, y: -10 }}
 transition={{ duration: 0.2 }}
 >
 <TabsContent value="overview" className="mt-0">
 <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
 {/* Main Content: File List Style */}
 <div className="lg:col-span-8 xl:col-span-9 space-y-8">
 <div className="github-card">
 <div className="github-card-header">
 <div className="flex items-center gap-3">
 <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center border border-primary/20">
 <Database className="w-4 h-4 text-primary" />
 </div>
 <div className="flex flex-col">
 <span className="text-sm font-semibold text-foreground">System Pipeline Status</span>
 <span className="text-[10px] text-muted-foreground">Recent Sync Cycles</span>
 </div>
 </div>
 {runs.length > 0 && (
 <div className="flex items-center gap-3">
 <span className="text-[11px] font-mono text-muted-foreground">Last run: {new Date(runs[0].timestamp).toLocaleTimeString()}</span>
 {getStatusChip(runs[0].status)}
 </div>
 )}
 </div>
 <div className="overflow-hidden">
 <table className="github-table">
 <thead>
 <tr>
 <th className="w-8"></th>
 <th>Sync Identifier</th>
 <th>Throughput</th>
 <th>Status</th>
 <th className="text-right">Timestamp</th>
 </tr>
 </thead>
 <tbody>
 {runs.slice(0, 8).map((run) => (
 <tr key={run.id} onClick={() => openRunDetails(run)} className="cursor-pointer group">
 <td className="w-8 pl-6 pr-1">
 <FileText className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
 </td>
 <td className="font-mono text-[13px] text-foreground group-hover:text-primary transition-colors py-4">
 {run.triggerType.toLowerCase()}_sync_{run.id.substring(0, 7)}.log
 </td>
 <td className="text-[13px] text-muted-foreground py-4">
 <span className="font-semibold text-foreground">{run.totalItemsParsed}</span> items processed
 </td>
 <td className="py-4">
 {getStatusChip(run.status)}
 </td>
 <td className="text-right font-mono text-[12px] text-muted-foreground py-4 pr-6">
 {new Date(run.timestamp).toLocaleDateString()}
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </div>

 {/* README Style Section */}
 <div className="github-card">
 <div className="github-card-header sticky top-0 z-10 backdrop-blur-md">
 <div className="flex items-center gap-3">
 <BookOpen className="w-4 h-4 text-primary" />
 <span className="text-sm font-semibold text-foreground">System Documentation</span>
 </div>
 <Badge variant="outline" className="text-[10px] border-border text-muted-foreground">README.md</Badge>
 </div>
 <div className="p-10 markdown-body bg-transparent">
 <ReactMarkdown 
 remarkPlugins={[remarkGfm]} 
 rehypePlugins={[rehypeRaw]}
 components={{
 img: ({ node, ...props }) => (
 <img 
 {...props} 
 referrerPolicy="no-referrer" 
 className="max-w-full rounded-md border border-border shadow-sm my-4"
 />
 )
 }}
 >
 {readmeContent || 'Loading system documentation...'}
 </ReactMarkdown>
 </div>
 </div>
 </div>

 {/* Sidebar Stats */}
 <div className="lg:col-span-4 xl:col-span-3 space-y-8">
 <div className="github-card p-6 space-y-6">
 <div className="space-y-2">
 <h3 className="text-sm font-semibold text-muted-foreground mb-4">About System</h3>
 <p className="text-sm text-foreground leading-relaxed">
 Enterprise-grade technical intelligence aggregator. Built for high-density data synthesis and automated cloud architecture insights.
 </p>
 </div>
 
 <div className="space-y-4">
 <h3 className="text-sm font-semibold text-muted-foreground mb-4">System Metrics</h3>
 <div className="grid grid-cols-1 gap-3">
 <div className="bg-muted/50 rounded-md p-4 border border-border hover:border-primary/30 transition-colors group">
 <div className="flex items-center justify-between mb-1">
 <span className="text-xs font-semibold text-muted-foreground">Pipeline Health</span>
 <Activity className="w-3 h-3 text-success" />
 </div>
 <div className="text-2xl font-semibold text-foreground group-hover:text-primary transition-colors">{analytics?.successRate || 0}%</div>
 </div>
 <div className="bg-muted/50 rounded-md p-4 border border-border hover:border-primary/30 transition-colors group">
 <div className="flex items-center justify-between mb-1">
 <span className="text-xs font-semibold text-muted-foreground">Total Ingestion</span>
 <Database className="w-3 h-3 text-primary" />
 </div>
 <div className="text-2xl font-semibold text-foreground group-hover:text-primary transition-colors">{analytics?.totalItems ? (analytics.totalItems / 1000).toFixed(1) + 'k' : '0'}</div>
 </div>
 </div>
 </div>

 <div className="space-y-4">
 <h3 className="text-sm font-semibold text-muted-foreground mb-4">Source Integrity</h3>
 <div className="space-y-3">
 {metrics.slice(0, 6).map(m => (
 <div key={m.id} className="flex items-center justify-between group cursor-pointer" onClick={() => setActiveTab('sources')}>
 <div className="flex items-center gap-3 overflow-hidden">
 <div className={`w-2 h-2 rounded-full shrink-0 ${m.healthStatus === 'HEALTHY' ? 'bg-success shadow-sm' : 'bg-error shadow-sm'}`} />
 <span className="text-xs font-semibold text-muted-foreground truncate group-hover:text-primary transition-colors">{m.sourceName}</span>
 </div>
 <span className="text-[10px] font-mono text-muted-foreground">{m.itemsParsedLastSync}</span>
 </div>
 ))}
 </div>
 {metrics.length > 6 && (
 <Button variant="ghost" size="sm" onClick={() => setActiveTab('sources')} className="w-full text-[11px] text-primary font-semibold justify-center hover:bg-accent rounded-md">
 View {metrics.length - 6} more sources
 </Button>
 )}
 </div>
 </div>
 </div>
 </div>
 </TabsContent>

 <TabsContent value="gemini" className="mt-0">
 <div className="github-card">
 <div className="github-card-header">
 <div className="flex items-center gap-3">
 <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center border border-primary/20">
 <Sparkles className="w-4 h-4 text-primary" />
 </div>
 <div className="flex flex-col">
 <span className="text-sm font-semibold text-foreground">Intelligence Synthesis</span>
 <span className="text-[10px] text-muted-foreground">Gemini 1.5 Flash Analysis</span>
 </div>
 </div>
 <div className="flex items-center gap-3">
 <Button
 onClick={fetchGeminiBrief}
 disabled={geminiLoading}
 className="github-btn github-btn-secondary h-9 px-4"
 >
 {geminiLoading ? <RefreshCw className="w-3 h-3 animate-spin mr-2" /> : <RefreshCw className="w-3 h-3 mr-2" />}
 Regenerate Analysis
 </Button>
 </div>
 </div>
 <div className="p-0 bg-transparent">
 {geminiLoading ? (
 <div className="flex flex-col items-center justify-center py-40 space-y-6">
 <div className="relative">
 <div className="absolute inset-0 bg-primary/20 blur-3xl rounded-full animate-pulse" />
 <RefreshCw className="w-12 h-12 text-primary animate-spin relative z-10" />
 </div>
 <div className="flex flex-col items-center gap-2">
 <p className="text-lg font-semibold text-foreground">Synthesizing Intelligence...</p>
 <p className="text-sm text-muted-foreground font-mono">Analyzing {analytics?.totalItems || 0} data points across {metrics.length} sources</p>
 </div>
 </div>
 ) : geminiError ? (
 <div className="flex flex-col items-center justify-center py-40 text-center px-4">
 <div className="w-16 h-16 rounded-md bg-error/10 flex items-center justify-center mb-6 border border-error/20">
 <AlertCircle className="w-8 h-8 text-error" />
 </div>
 <h3 className="text-xl font-semibold text-foreground mb-2">Synthesis Interrupted</h3>
 <p className="text-sm text-muted-foreground mb-8 max-w-md mx-auto leading-relaxed">{geminiError}</p>
 <Button onClick={fetchGeminiBrief} className="github-btn github-btn-primary">
 Retry Analysis
 </Button>
 </div>
 ) : geminiBrief ? (
 <div className="p-8 sm:p-12 lg:p-16 relative">
 <div className="absolute inset-0 pointer-events-none" />
 <motion.div 
 initial={{ opacity: 0, y: 20 }}
 animate={{ opacity: 1, y: 0 }}
 transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
 className="markdown-body bg-card border border-border rounded-md p-8 sm:p-12 relative overflow-hidden group"
 >
 <div className="absolute top-0 left-0 w-full h-1 bg-primary" />
 
 <div className="relative z-10">
 <ReactMarkdown 
 remarkPlugins={[remarkGfm]} 
 rehypePlugins={[rehypeRaw]}
 components={{
 img: ({ node, ...props }) => (
 <img 
 {...props} 
 referrerPolicy="no-referrer" 
 className="max-w-full rounded-md border border-border shadow-sm my-6"
 />
 )
 }}
 >
 {geminiBrief}
 </ReactMarkdown>
 </div>

 <div className="mt-16 pt-8 border-t border-border flex items-center justify-between">
 <div className="flex items-center gap-4">
 <div className="flex -space-x-2">
 {[1, 2, 3].map(i => (
 <div key={i} className="w-6 h-6 rounded-full bg-muted border-2 border-card flex items-center justify-center">
 <div className="w-1 h-1 rounded-full bg-primary animate-pulse" style={{ animationDelay: `${i * 0.2}s` }} />
 </div>
 ))}
 </div>
 <span className="text-xs font-semibold text-muted-foreground">Synthesis Engine Active</span>
 </div>
 <div className="text-[10px] font-mono text-muted-foreground">
 Generated {new Date().toLocaleTimeString()} • {geminiBrief.length} tokens processed
 </div>
 </div>
 </motion.div>
 </div>
 ) : (
 <div className="text-center py-40 px-4">
 <div className="w-20 h-20 rounded-md bg-muted flex items-center justify-center mx-auto mb-8 border border-border group hover:scale-110 transition-transform duration-500">
 <Sparkles className="w-10 h-10 text-muted-foreground group-hover:text-primary transition-colors" />
 </div>
 <h3 className="text-2xl font-semibold text-foreground mb-3">No Intelligence Brief</h3>
 <p className="text-sm text-muted-foreground mb-10 max-w-md mx-auto leading-relaxed">
 Trigger a synchronization cycle to provide Gemini with fresh technical data for multi-source synthesis and architectural analysis.
 </p>
 <Button onClick={fetchGeminiBrief} className="github-btn github-btn-primary">
 Generate Intelligence Now
 </Button>
 </div>
 )}
 </div>
 </div>
 </TabsContent>

 <TabsContent value="sources" className="mt-0">
 <div className="github-card">
 <div className="github-card-header">
 <div className="flex items-center gap-3">
 <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center border border-border">
 <Database className="w-4 h-4 text-muted-foreground" />
 </div>
 <div className="flex flex-col">
 <span className="text-sm font-semibold text-foreground">Data Source Matrix</span>
 <span className="text-[10px] text-muted-foreground">Active Ingestion Nodes</span>
 </div>
 </div>
 <div className="flex items-center gap-3">
 <div className="text-xs font-semibold text-muted-foreground mr-4">
 <span className="text-foreground">{metrics.length}</span> Nodes Online
 </div>
 <Button onClick={() => setShowAddSourceDialog(true)} className="github-btn github-btn-primary">
 Add New Source
 </Button>
 <Button onClick={() => fetchData()} className="github-btn github-btn-secondary h-9 px-4">
 <RefreshCw className={`w-3 h-3 mr-2 ${loading ? 'animate-spin' : ''}`} />
 Refresh Matrix
 </Button>
 </div>
 </div>
 <div className="overflow-hidden">
 <table className="github-table">
 <thead>
 <tr>
 <th>Source Entity</th>
 <th>Origin</th>
 <th>Health Status</th>
 <th>Last Ingestion</th>
 <th className="text-right">Throughput</th>
 <th className="text-right">Operations</th>
 </tr>
 </thead>
 <tbody>
 {dataSources.map((ds) => {
 const m = metrics.find(metric => metric.id === ds.id);
 const isFailing = ds.circuitOpen || ds.consecutiveFailures > 0 || (m && m.healthStatus !== 'HEALTHY');
 return (
 <tr key={ds.id} className={`group hover:bg-muted/50 transition-all duration-300 ${!ds.isActive ? 'opacity-40' : ''}`}>
 <td className="py-6 pl-8">
 <div className="flex flex-col gap-1.5">
 <span className="font-semibold text-foreground group-hover:text-primary transition-colors cursor-pointer text-sm">{ds.name}</span>
 <div className="flex items-center gap-2">
 <div className="w-1 h-1 rounded-full bg-border" />
 <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[200px] group-hover:text-foreground transition-colors">{ds.url}</span>
 </div>
 </div>
 </td>
 <td>
 <div className="flex items-center gap-2">
 <div className={`w-1.5 h-1.5 rounded-full ${ds.origin === 'SYSTEM' ? 'bg-primary' : 'bg-purple'}`} />
 <span className={`text-xs font-semibold ${ds.origin === 'SYSTEM' ? 'text-primary' : 'text-purple'}`}>
 {ds.origin}
 </span>
 </div>
 </td>
 <td>
 <div className="flex flex-col gap-2">
 <div className="flex items-center gap-3">
 <div className={`w-2 h-2 rounded-full ring-4 ring-opacity-20 ${!ds.isActive ? 'bg-muted ring-muted' : ds.circuitOpen ? 'bg-error ring-error animate-pulse' : isFailing ? 'bg-warning ring-warning' : 'bg-success ring-success'}`} />
 <span className="text-xs font-semibold text-foreground">
 {!ds.isActive ? 'INACTIVE' : ds.circuitOpen ? 'CIRCUIT OPEN' : m?.healthStatus || 'UNKNOWN'}
 </span>
 </div>
 {ds.consecutiveFailures > 0 && (
 <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-error/10 border border-error/20 w-fit">
 <AlertCircle className="w-2.5 h-2.5 text-error" />
 <span className="text-[10px] text-error font-mono font-semibold">{ds.consecutiveFailures} Failures</span>
 </div>
 )}
 </div>
 </td>
 <td className="text-[11px] text-muted-foreground font-medium">
 <div className="flex flex-col gap-1">
 <div className="flex items-center gap-2">
 <Clock className="w-3 h-3 text-muted-foreground/50" />
 <span>{m?.lastSyncTimestamp ? new Date(m.lastSyncTimestamp).toLocaleString() : 'NEVER'}</span>
 </div>
 {m?.lastTriggerType && (
 <span className="text-xs text-muted-foreground/70 font-semibold ml-5">{m.lastTriggerType}</span>
 )}
 </div>
 </td>
 <td className="text-right pr-8">
 <div className="flex flex-col items-end gap-1">
 <div className="flex items-center gap-2">
 <span className="text-sm font-mono font-semibold text-foreground">{m?.itemsParsedLastSync || 0}</span>
 <Zap className="w-3 h-3 text-warning" />
 </div>
 <span className="text-xs text-muted-foreground font-semibold">Ingested</span>
 </div>
 </td>
 <td className="text-right">
 <div className="flex items-center justify-end gap-2">
 {ds.circuitOpen && (
 <Button 
 variant="ghost" 
 size="sm" 
 onClick={async () => {
 await fetchJson(`/api/v1/sources/${ds.id}/reset-circuit`, { method: 'POST' });
 fetchData();
 toast.success('Circuit reset');
 }} 
 className="h-8 px-3 text-xs font-semibold text-error border border-error/20 hover:bg-error/10 rounded-md"
 >
 Reset Circuit
 </Button>
 )}
 <Button 
 variant="ghost" 
 size="icon" 
 onClick={() => {
 setEditingSource(ds);
 setShowEditSourceDialog(true);
 }}
 className="h-9 w-9 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-md transition-all"
 >
 <Pencil className="w-4 h-4" />
 </Button>
 <Button 
 variant="ghost" 
 size="icon" 
 onClick={async () => {
 await fetchJson(`/api/v1/sources/${ds.id}`, {
 method: 'PUT',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ ...ds, isActive: !ds.isActive })
 });
 fetchData();
 }}
 className={`h-9 w-9 rounded-md transition-all ${ds.isActive ? 'text-warning hover:bg-warning/10' : 'text-success hover:bg-success/10'}`}
 >
 {ds.isActive ? <XCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
 </Button>
 {ds.origin === 'USER' && (
 <Button 
 variant="ghost" 
 size="icon" 
 onClick={() => setSourceToDelete(ds.id)}
 className="h-9 w-9 text-error hover:bg-error/10 rounded-md transition-all"
 >
 <X className="w-4 h-4" />
 </Button>
 )}
 <Button 
 variant="ghost" 
 size="icon" 
 onClick={() => testConnection(ds.id)}
 className="h-8 w-8 text-primary hover:bg-primary/10 rounded-md"
 >
 <Activity className="w-3.5 h-3.5" />
 </Button>
 <Button 
 variant="ghost" 
 size="icon" 
 onClick={() => triggerSync(ds.id, true)} 
 disabled={!ds.isActive || ds.circuitOpen} 
 className="h-8 w-8 text-success hover:bg-success/10 rounded-md disabled:opacity-20"
 >
 <Play className="w-3.5 h-3.5" />
 </Button>
 </div>
 </td>
 </tr>
 );
 })}
 </tbody>
 </table>
 </div>
 </div>
 </TabsContent>

 <TabsContent value="files" className="mt-0">
 <div className="github-card">
 <div className="github-card-header">
 <div className="flex items-center gap-3">
 <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center border border-border">
 <FileText className="w-4 h-4 text-muted-foreground" />
 </div>
 <div className="flex flex-col">
 <span className="text-sm font-semibold text-foreground">Artifact Repository</span>
 <span className="text-[10px] text-muted-foreground">Secure Storage Layer</span>
 </div>
 </div>
 <div className="flex items-center gap-3">
 <div className="text-xs font-semibold text-muted-foreground mr-4">
 <span className="text-foreground">{files.length}</span> Objects Stored
 </div>
 <Button onClick={handleDownloadAll} disabled={files.length === 0} className="github-btn github-btn-secondary">
 <Download className="w-3.5 h-3.5 mr-2" />
 Download All
 </Button>
 <Button onClick={() => setIsGCSDialogOpen(true)} disabled={files.length === 0} className="github-btn github-btn-secondary">
 <Cloud className="w-3.5 h-3.5 mr-2" />
 Export to GCS
 </Button>
 <Button onClick={() => fetchData()} className="github-btn github-btn-secondary h-9 px-4">
 <RefreshCw className={`w-3 h-3 mr-2 ${loading ? 'animate-spin' : ''}`} />
 Refresh Repository
 </Button>
 </div>
 </div>
 <div className="overflow-hidden">
 <div className="divide-y divide-border">
 {files.map((file) => (
 <div key={file.name} className="flex items-center justify-between px-6 py-4 hover:bg-muted/50 transition-colors group">
 <div className="flex items-center gap-4 min-w-0">
 <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center border border-border shrink-0">
 <FileText className="w-4 h-4 text-muted-foreground" />
 </div>
 <div className="flex flex-col min-w-0">
 <span className="text-sm font-semibold text-foreground truncate group-hover:text-primary transition-colors cursor-pointer">{file.name}</span>
 <span className="text-[10px] text-muted-foreground font-mono">Modified: {new Date(file.lastModified).toLocaleString()}</span>
 </div>
 </div>
 <div className="flex items-center gap-6 shrink-0">
 <span className="text-[11px] font-mono text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</span>
 <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
 <Button 
 variant="ghost" 
 size="icon" 
 onClick={() => window.open(`/api/v1/files/${file.name}`, '_blank')}
 className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md"
 >
 <Eye className="w-3.5 h-3.5" />
 </Button>
 <Button 
 variant="ghost" 
 size="icon" 
 onClick={() => window.open(`/api/v1/files/${file.name}?download=1`, '_blank')}
 className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md"
 >
 <Download className="w-3.5 h-3.5" />
 </Button>
 </div>
 </div>
 </div>
 ))}
 {files.length === 0 && (
 <div className="py-20 text-center text-muted-foreground">
 <div className="flex flex-col items-center gap-2">
 <FileText className="w-8 h-8 opacity-20" />
 <p className="text-sm">No output artifacts found.</p>
 </div>
 </div>
 )}
 </div>
 </div>
 </div>
 </TabsContent>

 <TabsContent value="debug" className="mt-0 h-[700px] flex flex-col">
 <div className="github-card flex-1 flex flex-col overflow-hidden">
 <div className="github-card-header">
 <div className="flex items-center gap-3">
 <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center border border-border">
 <Terminal className="w-4 h-4 text-muted-foreground" />
 </div>
 <div className="flex flex-col">
 <span className="text-sm font-semibold text-foreground">System Logs</span>
 <span className="text-[10px] text-muted-foreground">Real-time Execution Stream</span>
 </div>
 </div>
 <div className="flex items-center gap-3">
 <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground mr-2">
 <span className="relative flex h-2 w-2">
 <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
 <span className="relative inline-flex rounded-full h-2 w-2 bg-success"></span>
 </span>
 Live Stream
 </div>
 <Button 
 onClick={() => setAutoScroll(!autoScroll)}
 className={`github-btn h-8 px-3 text-[11px] font-semibold ${autoScroll ? 'github-btn-primary' : 'github-btn-secondary'}`}
 >
 Auto-scroll: {autoScroll ? 'ON' : 'OFF'}
 </Button>
 </div>
 </div>
 
 <div className="flex flex-col sm:flex-row gap-4 p-4 border-b border-border bg-muted/30">
 <div className="relative flex-1">
 <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
 <Input
 placeholder="Filter log stream..."
 className="github-input pl-9 h-9 text-sm"
 value={debugSearch}
 onChange={(e) => { setDebugSearch(e.target.value); setDebugPage(1); }}
 />
 </div>
 <Select value={debugLevel} onValueChange={(val) => { setDebugLevel(val); setDebugPage(1); }}>
 <SelectTrigger className="github-input w-[160px] h-9 text-xs font-semibold text-muted-foreground">
 <div className="flex items-center gap-2">
 <ListFilter className="w-3 h-3" />
 <SelectValue placeholder="Level" />
 </div>
 </SelectTrigger>
 <SelectContent className="github-card border-border">
 <SelectItem value="ALL">ALL LEVELS</SelectItem>
 <SelectItem value="INFO">INFO ONLY</SelectItem>
 <SelectItem value="WARN">WARNINGS</SelectItem>
 <SelectItem value="ERROR">ERRORS</SelectItem>
 </SelectContent>
 </Select>
 </div>

 <div className="flex-1 flex overflow-hidden min-h-0">
 <div className={`flex-1 flex flex-col overflow-hidden min-h-0 ${selectedLog ? 'w-2/3 border-r border-border' : 'w-full'}`}>
 <ScrollArea className="flex-1 overflow-hidden min-h-0 bg-card text-foreground" ref={debugScrollRef}>
 <div className="p-4 font-mono text-[11px] leading-relaxed">
 {debugLogs.map((log) => (
 <div 
 key={log.id} 
 onClick={() => setSelectedLog(log)}
 className={`flex gap-4 px-3 py-1.5 cursor-pointer hover:bg-muted/50 border-l-2 transition-all ${
 selectedLog?.id === log.id 
 ? 'bg-muted border-primary text-foreground' 
 : 'border-transparent hover:border-border'
 }`}
 >
 <span className="text-muted-foreground shrink-0 tabular-nums">{new Date(log.timestamp).toISOString().split('T')[1].split('.')[0]}</span>
 <span className={`shrink-0 w-[50px] font-semibold text-center rounded px-1 py-0.5 text-[9px] ${
 log.level === 'ERROR' ? 'bg-error/20 text-error border border-error/30' : 
 log.level === 'WARN' ? 'bg-warning/20 text-warning border border-warning/30' : 
 'bg-primary/20 text-primary border border-primary/30'
 }`}>
 {log.level}
 </span>
 <span className="truncate flex-1 font-medium">{log.message}</span>
 </div>
 ))}
 </div>
 </ScrollArea>
 <div className="px-6 py-3 border-t border-border bg-muted flex items-center justify-between text-xs font-semibold text-muted-foreground">
 <div>
 <span className="text-foreground">{debugTotal}</span> Events Found
 </div>
 <div className="flex gap-3">
 <Button onClick={() => setDebugPage(p => Math.max(1, p - 1))} disabled={debugPage === 1} className="github-btn github-btn-secondary h-8 px-4 text-[10px] font-semibold">
 Previous
 </Button>
 <Button onClick={() => setDebugPage(p => p + 1)} disabled={debugPage * 50 >= debugTotal} className="github-btn github-btn-secondary h-8 px-4 text-[10px] font-semibold">
 Next Page
 </Button>
 </div>
 </div>
 </div>

 <AnimatePresence>
 {selectedLog && (
 <motion.div 
 initial={{ width: 0, opacity: 0 }}
 animate={{ width: '33.333333%', opacity: 1 }}
 exit={{ width: 0, opacity: 0 }}
 className="bg-card flex flex-col overflow-hidden border-l border-border"
 >
 <div className="p-4 border-b border-border flex justify-between items-center bg-muted/50">
 <div className="flex items-center gap-2">
 <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center border border-primary/20">
 <Activity className="w-3 h-3 text-primary" />
 </div>
 <span className="text-sm font-semibold text-foreground">Event Details</span>
 </div>
 <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted" onClick={() => setSelectedLog(null)}>
 <X className="w-3.5 h-3.5" />
 </Button>
 </div>
 <ScrollArea className="flex-1 p-6">
 <div className="space-y-6">
 <div>
 <h4 className="text-xs font-semibold text-muted-foreground mb-3">Timestamp</h4>
 <div className="bg-muted/50 rounded-lg p-3 border border-border font-mono text-xs text-foreground">
 {new Date(selectedLog.timestamp).toLocaleString()}
 </div>
 </div>
 <div>
 <h4 className="text-xs font-semibold text-muted-foreground mb-3">Severity Level</h4>
 <div className={`inline-flex items-center px-3 py-1 rounded-full text-[10px] font-semibold border ${
 selectedLog.level === 'ERROR' ? 'bg-error/20 text-error border-error/30' : 
 selectedLog.level === 'WARN' ? 'bg-warning/20 text-warning border-warning/30' : 
 'bg-primary/20 text-primary border-primary/30'
 }`}>
 {selectedLog.level}
 </div>
 </div>
 <div>
 <h4 className="text-xs font-semibold text-muted-foreground mb-3">Message Payload</h4>
 <div className="bg-muted/50 rounded-md p-4 border border-border font-mono text-xs text-foreground leading-relaxed break-words">
 {selectedLog.message}
 </div>
 </div>
 {selectedLog.metadata && (
 <div>
 <h4 className="text-xs font-semibold text-muted-foreground mb-3">Extended Metadata</h4>
 <pre className="bg-muted/50 rounded-md p-4 border border-border font-mono text-[10px] text-primary overflow-x-auto">
 {(() => {
 try {
 return JSON.stringify(JSON.parse(selectedLog.metadata), null, 2);
 } catch {
 return selectedLog.metadata;
 }
 })()}
 </pre>
 </div>
 )}
 </div>
 </ScrollArea>
 </motion.div>
 )}
 </AnimatePresence>
 </div>
 </div>
 </TabsContent>

 <TabsContent value="network" className="mt-0 h-[700px] flex flex-col">
 <div className="github-card flex-1 flex flex-col overflow-hidden">
 <div className="github-card-header">
 <div className="flex items-center gap-3">
 <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center border border-border">
 <Activity className="w-4 h-4 text-muted-foreground" />
 </div>
 <div className="flex flex-col">
 <span className="text-sm font-semibold text-foreground">Network Telemetry</span>
 <span className="text-[10px] text-muted-foreground">HTTP Traffic Monitor</span>
 </div>
 </div>
 <div className="flex items-center gap-3">
 <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground mr-2">
 <span className="relative flex h-2 w-2">
 <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
 <span className="relative inline-flex rounded-full h-2 w-2 bg-success"></span>
 </span>
 Live Monitor
 </div>
 <Button onClick={() => fetchData()} className="github-btn github-btn-secondary h-8 px-3 text-[11px] font-semibold">
 <RefreshCw className={`w-3 h-3 mr-1.5 ${networkLoading ? 'animate-spin' : ''}`} />
 Refresh
 </Button>
 </div>
 </div>
 
 <div className="flex flex-col sm:flex-row gap-4 p-4 border-b border-border bg-muted/30">
 <div className="relative flex-1">
 <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
 <Input
 placeholder="Filter network requests..."
 className="github-input pl-9 h-9 text-sm"
 value={networkSearch}
 onChange={(e) => { setNetworkSearch(e.target.value); setNetworkPage(1); }}
 />
 </div>
 </div>
 
 <div className="flex-1 flex overflow-hidden min-h-0">
 <div className={`flex-1 flex flex-col overflow-hidden min-h-0 ${selectedNetworkLog ? 'w-2/3 border-r border-border' : 'w-full'}`}>
 <ScrollArea className="flex-1 overflow-hidden min-h-0 bg-card text-foreground">
 <div className="p-4 font-mono text-[11px] leading-relaxed">
 {networkLogs.map((log) => {
 let meta: any = {};
 try { meta = JSON.parse(log.metadata || '{}'); } catch (e) {}
 return (
 <div 
 key={log.id} 
 onClick={() => setSelectedNetworkLog(log)}
 className={`flex gap-4 px-3 py-1.5 cursor-pointer hover:bg-muted/50 border-l-2 transition-all ${
 selectedNetworkLog?.id === log.id 
 ? 'bg-muted border-primary text-foreground' 
 : 'border-transparent hover:border-border'
 }`}
 >
 <span className="text-muted-foreground shrink-0 tabular-nums">{new Date(log.timestamp).toISOString().split('T')[1].split('.')[0]}</span>
 <span className={`shrink-0 w-[50px] font-semibold text-center rounded px-1 py-0.5 text-[9px] ${
 meta.status >= 400 ? 'bg-error/20 text-error border border-error/30' : 'bg-success/20 text-success border border-success/30'
 }`}>
 {meta.method || 'GET'}
 </span>
 <span className={`shrink-0 w-[35px] font-semibold ${
 meta.status >= 400 ? 'text-error' : 'text-success'
 }`}>
 {meta.status || '200'}
 </span>
 <span className="truncate flex-1 font-medium">{meta.url || log.message}</span>
 <span className="text-muted-foreground shrink-0 font-semibold">{meta.duration ? `${meta.duration}ms` : ''}</span>
 </div>
 );
 })}
 </div>
 </ScrollArea>
 <div className="px-6 py-3 border-t border-border bg-muted flex items-center justify-between text-xs font-semibold text-muted-foreground">
 <div>
 <span className="text-foreground">{networkTotal}</span> Requests Recorded
 </div>
 <div className="flex gap-3">
 <Button onClick={() => setNetworkPage(p => Math.max(1, p - 1))} disabled={networkPage === 1} className="github-btn github-btn-secondary h-8 px-4 text-[10px] font-semibold">
 Previous
 </Button>
 <Button onClick={() => setNetworkPage(p => p + 1)} disabled={networkPage * 50 >= networkTotal} className="github-btn github-btn-secondary h-8 px-4 text-[10px] font-semibold">
 Next Page
 </Button>
 </div>
 </div>
 </div>

 {/* Network Details Pane */}
 <AnimatePresence>
 {selectedNetworkLog && (
 <motion.div 
 initial={{ width: 0, opacity: 0 }}
 animate={{ width: '33.333333%', opacity: 1 }}
 exit={{ width: 0, opacity: 0 }}
 className="bg-card flex flex-col overflow-hidden border-l border-border"
 >
 <div className="p-4 border-b border-border flex justify-between items-center bg-muted/50">
 <div className="flex items-center gap-2">
 <div className="w-6 h-6 rounded-md bg-success/10 flex items-center justify-center border border-success/20">
 <Activity className="w-3 h-3 text-success" />
 </div>
 <span className="text-sm font-semibold text-foreground">Request Details</span>
 </div>
 <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted" onClick={() => setSelectedNetworkLog(null)}>
 <X className="w-3.5 h-3.5" />
 </Button>
 </div>
 <ScrollArea className="flex-1 p-6">
 <div className="space-y-6">
 {(() => {
 let meta: any = {};
 try { meta = JSON.parse(selectedNetworkLog.metadata || '{}'); } catch (e) {}
 return (
 <>
 <div className="flex items-center gap-3 mb-6">
 <div className={`px-3 py-1 rounded-full text-[10px] font-semibold border ${
 meta.status >= 400 ? 'bg-error/20 text-error border-error/30' : 'bg-success/20 text-success border-success/30'
 }`}>
 {meta.method || 'UNKNOWN'}
 </div>
 <div className={`px-3 py-1 rounded-full text-[10px] font-semibold border ${
 meta.status >= 400 ? 'bg-error/20 text-error border-error/30' : 'bg-success/20 text-success border-success/30'
 }`}>
 {meta.status || '---'}
 </div>
 <span className="text-xs font-semibold text-muted-foreground">{meta.duration ? `${meta.duration}ms` : ''}</span>
 </div>
 
 <div>
 <h4 className="text-xs font-semibold text-muted-foreground mb-3">Endpoint URL</h4>
 <div className="bg-muted/50 rounded-md p-3 border border-border font-mono text-xs text-primary break-all leading-relaxed">
 {meta.url || selectedNetworkLog.message}
 </div>
 </div>
 
 <div>
 <h4 className="text-xs font-semibold text-muted-foreground mb-3">Timestamp</h4>
 <div className="bg-muted/50 rounded-lg p-3 border border-border font-mono text-xs text-foreground">
 {new Date(selectedNetworkLog.timestamp).toLocaleString()}
 </div>
 </div>

 {meta.ip && (
 <div>
 <h4 className="text-xs font-semibold text-muted-foreground mb-3">Client IP Address</h4>
 <div className="bg-muted/50 rounded-lg p-3 border border-border font-mono text-xs text-foreground">
 {meta.ip}
 </div>
 </div>
 )}
 
 {meta.userAgent && (
 <div>
 <h4 className="text-xs font-semibold text-muted-foreground mb-3">User Agent String</h4>
 <div className="bg-muted/50 rounded-md p-3 border border-border font-mono text-[10px] text-muted-foreground break-all leading-relaxed">
 {meta.userAgent}
 </div>
 </div>
 )}

 <div className="pt-4 border-t border-border">
 <h4 className="text-xs font-semibold text-muted-foreground mb-3">Full Metadata Payload</h4>
 <pre className="bg-muted/50 rounded-md p-4 border border-border font-mono text-[10px] text-success overflow-x-auto">
 {JSON.stringify(meta, null, 2)}
 </pre>
 </div>
 </>
 );
 })()}
 </div>
 </ScrollArea>
 </motion.div>
 )}
 </AnimatePresence>
 </div>
 </div>
 </TabsContent>
 <TabsContent value="settings" className="mt-0">
 <div className="github-card">
 <div className="github-card-header">
 <div className="flex items-center gap-3">
 <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center border border-border">
 <Settings className="w-4 h-4 text-muted-foreground" />
 </div>
 <div className="flex flex-col">
 <span className="text-sm font-semibold text-foreground">System Settings</span>
 <span className="text-[10px] text-muted-foreground">Configuration & Control</span>
 </div>
 </div>
 </div>
 <div className="flex flex-col min-h-[700px]">
 {/* Settings Content */}
 <div className="flex-1 p-8 space-y-12">
 <section className="space-y-8">
 <div className="flex items-start justify-between">
 <div>
 <h3 className="text-lg font-semibold text-foreground mb-2">General Configuration</h3>
 <p className="text-sm text-muted-foreground leading-relaxed max-w-md">Manage your core system preferences, data retention policies, and global environment variables.</p>
 </div>
 <div className="px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-[10px] font-semibold text-primary">
 System v{__APP_VERSION__}
 </div>
 </div>
 
 <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
 <div className="space-y-4">
 <div className="flex items-center gap-2">
 <Clock className="w-4 h-4 text-primary" />
 <Label className="text-sm font-semibold text-foreground">Log Retention Policy</Label>
 </div>
 <Select 
 value={settings.logRetentionDays || '0'} 
 onValueChange={(val) => updateSetting('logRetentionDays', val)}
 >
 <SelectTrigger className="github-input h-11 text-sm">
 <SelectValue placeholder="Select retention" />
 </SelectTrigger>
 <SelectContent className="github-card border-border">
 <SelectItem value="0">Forever (No Purge)</SelectItem>
 <SelectItem value="7">7 Days Retention</SelectItem>
 <SelectItem value="30">30 Days Retention</SelectItem>
 <SelectItem value="90">90 Days Retention</SelectItem>
 </SelectContent>
 </Select>
 <p className="text-[11px] text-muted-foreground leading-relaxed italic">
 Determines how long system and network telemetry logs are stored before being automatically purged from the database.
 </p>
 </div>

 <div className="space-y-4">
 <div className="flex items-center gap-2">
 <ShieldCheck className="w-4 h-4 text-success" />
 <Label className="text-sm font-semibold text-foreground">Security Level</Label>
 </div>
 <div className="h-11 bg-muted border border-border rounded-md flex items-center px-4 text-sm text-muted-foreground italic">
 Standard Enterprise Protection Enabled
 </div>
 <p className="text-[11px] text-muted-foreground leading-relaxed italic">
 Your system is currently running with standard security protocols. Advanced RBAC controls are managed via IAM.
 </p>
 </div>
 </div>
 </section>

 <section className="space-y-8">
 <div>
 <h3 className="text-lg font-semibold text-foreground mb-2">System Health & Metrics</h3>
 <p className="text-sm text-muted-foreground leading-relaxed max-w-md">Real-time performance metrics of the underlying database, file system, and application runtime.</p>
 </div>
 
 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
 <div className="p-6 bg-muted/50 border border-border rounded-md hover:border-primary/30 transition-colors group">
 <div className="flex items-center justify-between mb-4">
 <Database className="w-4 h-4 text-primary group-hover:scale-110 transition-transform" />
 <span className="text-xs font-semibold text-muted-foreground">Storage</span>
 </div>
 <div className="text-2xl font-mono font-semibold text-foreground">{(systemStatus?.dbSize / 1024).toFixed(1)} <span className="text-xs text-muted-foreground">KB</span></div>
 <div className="mt-2 text-[10px] text-muted-foreground font-medium">Database Payload Size</div>
 </div>
 
 <div className="p-6 bg-muted/50 border border-border rounded-md hover:border-primary/30 transition-colors group">
 <div className="flex items-center justify-between mb-4">
 <FileText className="w-4 h-4 text-success group-hover:scale-110 transition-transform" />
 <span className="text-xs font-semibold text-muted-foreground">Artifacts</span>
 </div>
 <div className="text-2xl font-mono font-semibold text-foreground">{systemStatus?.fileCount || 0} <span className="text-xs text-muted-foreground">Objects</span></div>
 <div className="mt-2 text-[10px] text-muted-foreground font-medium">Total Files Stored</div>
 </div>

 <div className="p-6 bg-muted/50 border border-border rounded-md hover:border-primary/30 transition-colors group">
 <div className="flex items-center justify-between mb-4">
 <Activity className="w-4 h-4 text-primary group-hover:scale-110 transition-transform" />
 <span className="text-xs font-semibold text-muted-foreground">Uptime</span>
 </div>
 <div className="text-2xl font-mono font-semibold text-foreground">
 {systemStatus?.uptime ? (
 systemStatus.uptime > 86400 
 ? `${Math.floor(systemStatus.uptime / 86400)}d ${Math.floor((systemStatus.uptime % 86400) / 3600)}h`
 : systemStatus.uptime > 3600
 ? `${Math.floor(systemStatus.uptime / 3600)}h ${Math.floor((systemStatus.uptime % 3600) / 60)}m`
 : `${Math.floor(systemStatus.uptime / 60)}m`
 ) : '0m'}
 </div>
 <div className="mt-2 text-[10px] text-muted-foreground font-medium">Continuous Runtime</div>
 </div>

 <div className="p-6 bg-muted/50 border border-border rounded-md hover:border-primary/30 transition-colors group">
 <div className="flex items-center justify-between mb-4">
 <Server className="w-4 h-4 text-warning group-hover:scale-110 transition-transform" />
 <span className="text-xs font-semibold text-muted-foreground">Environment</span>
 </div>
 <div className="text-2xl font-mono font-semibold text-foreground">Production</div>
 <div className="mt-2 text-[10px] text-muted-foreground font-medium">Deployment Context</div>
 </div>
 </div>
 </section>

 <section className="pt-10">
 <div className="bg-error/5 border border-error/20 rounded-md overflow-hidden">
 <div className="bg-error/10 px-6 py-4 border-b border-error/20 flex items-center gap-3">
 <AlertCircle className="w-4 h-4 text-error" />
 <h3 className="text-xs font-semibold text-error">Critical Operations Zone</h3>
 </div>
 <div className="p-8 space-y-8 bg-card/40">
 <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
 <div className="space-y-1">
 <div className="text-base font-semibold text-foreground">Purge All System Data</div>
 <p className="text-sm text-muted-foreground leading-relaxed max-w-lg">
 Permanently delete all synchronization runs, telemetry logs, and generated artifacts. This action is <span className="text-error font-semibold underline">irreversible</span>.
 </p>
 </div>
 <Button 
 variant="outline" 
 onClick={() => setShowPurgeDialog(true)}
 disabled={purging}
 className="h-11 px-8 text-xs font-semibold text-error border-error/30 hover:bg-error hover:text-white transition-all shrink-0"
 >
 {purging ? 'Purging Data...' : 'Execute Full Purge'}
 </Button>
 </div>

 <div className="h-px bg-border w-full" />

 <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
 <div className="space-y-1">
 <div className="text-base font-semibold text-foreground">Factory Reset Configuration</div>
 <p className="text-sm text-muted-foreground leading-relaxed max-w-lg">
 Reset all system configuration settings to their default values. This will not delete your data but will reset retention policies.
 </p>
 </div>
 <Button 
 variant="outline" 
 onClick={() => setShowResetDialog(true)}
 className="h-11 px-8 text-xs font-semibold text-muted-foreground border-border hover:bg-muted hover:text-foreground transition-all shrink-0"
 >
 Reset to Defaults
 </Button>
 </div>
 </div>
 </div>
 </section>
 </div>
 </div>
 </div>
 </TabsContent>
 </motion.div>
 </AnimatePresence>
 </main>
 </Tabs>

 <Dialog open={showAddSourceDialog} onOpenChange={setShowAddSourceDialog}>
 <DialogContent className="max-w-md bg-card border-border">
 <DialogHeader>
 <DialogTitle>Add Data Source</DialogTitle>
 <DialogDescription>Add a new RSS, Atom, or JSON feed to monitor.</DialogDescription>
 </DialogHeader>
 <div className="space-y-4 py-4">
 <div className="space-y-2">
 <Label>Name</Label>
 <Input 
 value={newSource.name} 
 onChange={(e) => setNewSource({ ...newSource, name: e.target.value })} 
 placeholder="e.g. My Custom Feed" 
 />
 </div>
 <div className="space-y-2">
 <Label>URL</Label>
 <Input 
 value={newSource.url} 
 onChange={(e) => setNewSource({ ...newSource, url: e.target.value })} 
 placeholder="https://..." 
 />
 </div>
 <div className="space-y-2">
 <Label>Type</Label>
 <Select value={newSource.type} onValueChange={(val) => setNewSource({ ...newSource, type: val })}>
 <SelectTrigger>
 <SelectValue />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="rss">RSS</SelectItem>
 <SelectItem value="atom">Atom</SelectItem>
 <SelectItem value="json">JSON</SelectItem>
 </SelectContent>
 </Select>
 </div>
 </div>
 <div className="flex justify-end gap-2">
 <Button variant="outline" onClick={() => setShowAddSourceDialog(false)}>Cancel</Button>
 <Button onClick={async () => {
 try {
 await fetchJson('/api/v1/sources', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify(newSource)
 });
 toast.success('Source added successfully');
 setShowAddSourceDialog(false);
 setNewSource({ name: '', url: '', type: 'rss' });
 fetchData();
 } catch (err) {
 toast.error(err instanceof Error ? err.message : 'Failed to add source');
 }
 }}>Add Source</Button>
 </div>
 </DialogContent>
 </Dialog>

 <Dialog open={showEditSourceDialog} onOpenChange={setShowEditSourceDialog}>
 <DialogContent className="max-w-md bg-card border-border">
 <DialogHeader>
 <DialogTitle>Edit Data Source</DialogTitle>
 <DialogDescription>Modify the details of this data source.</DialogDescription>
 </DialogHeader>
 {editingSource && (
 <div className="space-y-4 py-4">
 <div className="space-y-2">
 <Label>Name</Label>
 <Input 
 value={editingSource.name} 
 onChange={(e) => setEditingSource({ ...editingSource, name: e.target.value })} 
 />
 </div>
 <div className="space-y-2">
 <Label>URL</Label>
 <Input 
 value={editingSource.url} 
 onChange={(e) => setEditingSource({ ...editingSource, url: e.target.value })} 
 />
 </div>
 <div className="space-y-2">
 <Label>Type</Label>
 <Select value={editingSource.type} onValueChange={(val) => setEditingSource({ ...editingSource, type: val })}>
 <SelectTrigger>
 <SelectValue />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="rss">RSS</SelectItem>
 <SelectItem value="atom">Atom</SelectItem>
 <SelectItem value="json">JSON</SelectItem>
 </SelectContent>
 </Select>
 </div>
 </div>
 )}
 <div className="flex justify-end gap-2">
 <Button variant="outline" onClick={() => setShowEditSourceDialog(false)}>Cancel</Button>
 <Button onClick={async () => {
 try {
 await fetchJson(`/api/v1/sources/${editingSource.id}`, {
 method: 'PUT',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify(editingSource)
 });
 toast.success('Source updated successfully');
 setShowEditSourceDialog(false);
 setEditingSource(null);
 fetchData();
 } catch (err) {
 toast.error(err instanceof Error ? err.message : 'Failed to update source');
 }
 }}>Save Changes</Button>
 </div>
 </DialogContent>
 </Dialog>

 <AlertDialog open={!!sourceToDelete} onOpenChange={(open) => !open && setSourceToDelete(null)}>
 <AlertDialogContent className="bg-card border-border">
 <AlertDialogHeader>
 <AlertDialogTitle>Delete Data Source</AlertDialogTitle>
 <AlertDialogDescription>
 Are you sure you want to delete this data source? This action cannot be undone.
 </AlertDialogDescription>
 </AlertDialogHeader>
 <AlertDialogFooter>
 <AlertDialogCancel className="github-btn github-btn-secondary">Cancel</AlertDialogCancel>
 <AlertDialogAction onClick={async () => {
 if (sourceToDelete) {
 try {
 await fetchJson(`/api/v1/sources/${sourceToDelete}`, { method: 'DELETE' });
 toast.success('Source deleted successfully');
 fetchData();
 } catch (err) {
 toast.error('Failed to delete source');
 }
 }
 setSourceToDelete(null);
 }} className="github-btn github-btn-primary bg-error hover:bg-error/90 text-white border-error">
 Delete
 </AlertDialogAction>
 </AlertDialogFooter>
 </AlertDialogContent>
 </AlertDialog>

 <Dialog open={!!selectedRun} onOpenChange={(open) => !open && setSelectedRun(null)}>
 <DialogContent className="max-w-[90vw] w-[1200px] h-[85vh] flex flex-col bg-card border-border p-0 overflow-hidden">
 <div className="github-card-header border-b border-border bg-muted/30">
 <div className="flex items-center gap-3">
 <span className="text-sm font-semibold">Sync Run Details</span>
 {selectedRun && getStatusBadge(selectedRun.status)}
 </div>
 </div>
 
 {selectedRun && (
 <div className="flex flex-col flex-1 overflow-hidden">
 <div className="p-6 border-b border-border bg-card">
 <div className="flex items-center justify-between mb-6">
 <div className="text-xs text-muted-foreground">
 Executed on <span className="text-foreground font-semibold">{new Date(selectedRun.timestamp).toLocaleString()}</span> via <span className="text-foreground font-semibold">{selectedRun.triggerType}</span>
 </div>
 </div>
 <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
 <div className="p-4 bg-muted/30 border border-border rounded-md shadow-sm">
 <div className="text-[10px] font-semibold text-muted-foreground mb-2">Items Parsed</div>
 <div className="text-lg font-mono font-semibold text-foreground">{selectedRun.totalItemsParsed}</div>
 </div>
 <div className="p-4 bg-muted/30 border border-border rounded-md shadow-sm">
 <div className="text-[10px] font-semibold text-muted-foreground mb-2">Files Generated</div>
 <div className="text-lg font-mono font-semibold text-foreground">{selectedRun.totalFilesGenerated}</div>
 </div>
 </div>

 {selectedRun.errorSummary && (
 <div className="mt-6 p-4 bg-error/5 border border-error/20 rounded-md text-error text-xs shadow-sm">
 <span className="font-semibold block mb-2 text-[10px]">Error Summary</span>
 <div className="font-mono leading-relaxed">{selectedRun.errorSummary}</div>
 </div>
 )}
 </div>

 <div className="flex-1 flex flex-col overflow-hidden">
 <div className="px-4 py-2 border-b border-border bg-muted/50 flex justify-between items-center">
 <span className="text-xs font-semibold text-muted-foreground">Execution Logs</span>
 {runLogsLoading && <RefreshCw className="w-3 h-3 animate-spin text-primary" />}
 </div>
 <div className="flex-1 overflow-y-auto bg-card text-foreground border-t border-border">
 <div className="p-6 font-mono text-[11px] leading-relaxed">
 {runLogsLoading ? (
 <div className="flex flex-col items-center justify-center py-20 gap-4">
 <RefreshCw className="w-8 h-8 animate-spin text-primary opacity-50" />
 <p className="text-muted-foreground font-mono animate-pulse">Fetching execution logs...</p>
 </div>
 ) : runLogs.length === 0 ? (
 <div className="text-muted-foreground italic text-center py-10">No execution logs recorded for this run.</div>
 ) : (
 <div className="space-y-1.5">
 {runLogs.map((log) => (
 <div key={log.id} className="flex gap-4 px-2 py-1 hover:bg-muted/50 rounded transition-colors group">
 <span className="text-muted-foreground shrink-0 w-[70px]">{new Date(log.timestamp).toISOString().split('T')[1].replace('Z', '')}</span>
 <span className={`shrink-0 w-[45px] font-semibold ${
 log.level === 'ERROR' ? 'text-error' : 
 log.level === 'WARN' ? 'text-warning' : 
 'text-primary'
 }`}>
 {log.level}
 </span>
 <span className="break-all text-muted-foreground group-hover:text-foreground transition-colors">{log.message}</span>
 </div>
 ))}
 </div>
 )}
 </div>
 </div>
 </div>
 </div>
 )}
 </DialogContent>
 </Dialog>

 <Dialog open={isGCSDialogOpen} onOpenChange={setIsGCSDialogOpen}>
 <DialogContent className="max-w-md bg-card border-border p-0 overflow-hidden">
 <div className="github-card-header border-b border-border bg-muted/30">
 <div className="flex items-center gap-3">
 <Cloud className="w-4 h-4 text-primary" />
 <span className="text-sm font-semibold">Export to GCS</span>
 </div>
 <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setIsGCSDialogOpen(false)}>
 <X className="h-3 w-3" />
 </Button>
 </div>
 
 <div className="p-6 space-y-6">
 <div className="space-y-4">
 <div className="space-y-2">
 <Label htmlFor="projectId" className="text-xs font-semibold text-muted-foreground">Google Cloud Project ID</Label>
 <Input 
 id="projectId" 
 placeholder="e.g. my-awesome-project" 
 value={gcsProjectId} 
 onChange={(e) => setGcsProjectId(e.target.value)}
 className="bg-muted/30 border-border font-mono text-sm"
 />
 </div>
 
 <div className="space-y-2">
 <Label htmlFor="bucketName" className="text-xs font-semibold text-muted-foreground">Destination Bucket Name</Label>
 <Input 
 id="bucketName" 
 placeholder="e.g. gcp-datanator-backups" 
 value={gcsBucketName} 
 onChange={(e) => setGcsBucketName(e.target.value)}
 className="bg-muted/30 border-border font-mono text-sm"
 />
 </div>
 
 <div className="space-y-2">
 <div className="flex justify-between items-center">
 <Label htmlFor="authCode" className="text-xs font-semibold text-muted-foreground">OAuth Authorization Code</Label>
 <a 
 href="https://accounts.google.com/o/oauth2/v2/auth?client_id=YOUR_CLIENT_ID&redirect_uri=postmessage&response_type=code&scope=https://www.googleapis.com/auth/devstorage.read_write&access_type=offline" 
 target="_blank" 
 rel="noreferrer"
 className="text-[10px] text-primary hover:underline font-semibold"
 >
 Get Code
 </a>
 </div>
 <Input 
 id="authCode" 
 placeholder="Paste your auth code here..." 
 value={gcsAuthCode} 
 onChange={(e) => setGcsAuthCode(e.target.value)}
 className="bg-muted/30 border-border font-mono text-sm"
 />
 <p className="text-[10px] text-muted-foreground italic">
 Note: You need to provide a valid OAuth code with GCS write permissions.
 </p>
 </div>
 </div>

 <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
 <Button onClick={() => setIsGCSDialogOpen(false)} className="github-btn github-btn-secondary">
 Cancel
 </Button>
 <Button 
 onClick={handleGCSExport} 
 disabled={isExporting || !gcsProjectId || !gcsBucketName || !gcsAuthCode}
 className="github-btn github-btn-primary"
 >
 {isExporting ? (
 <>
 <RefreshCw className="w-3 h-3 mr-2 animate-spin" />
 Exporting...
 </>
 ) : (
 <>
 <Cloud className="w-3 h-3 mr-2" />
 Start Export
 </>
 )}
 </Button>
 </div>
 </div>
 </DialogContent>
 </Dialog>
 <AlertDialog open={showPurgeDialog} onOpenChange={setShowPurgeDialog}>
 <AlertDialogContent className="github-card border-error/20 max-w-md">
 <AlertDialogHeader>
 <div className="w-12 h-12 rounded-md bg-error/10 flex items-center justify-center mb-4 border border-error/20">
 <AlertTriangle className="w-6 h-6 text-error" />
 </div>
 <AlertDialogTitle className="text-lg font-semibold text-foreground">Confirm System Purge</AlertDialogTitle>
 <AlertDialogDescription className="text-sm text-muted-foreground leading-relaxed">
 This action will permanently delete all synchronization runs, telemetry logs, and generated artifacts. This cannot be undone. Are you absolutely sure?
 </AlertDialogDescription>
 </AlertDialogHeader>
 <AlertDialogFooter className="mt-8 gap-3">
 <AlertDialogCancel className="github-btn github-btn-secondary">
 Cancel Operation
 </AlertDialogCancel>
 <AlertDialogAction 
 onClick={purgeSystem} 
 className="github-btn github-btn-primary bg-error hover:bg-error/90 text-white border-error"
 >
 {purging ? 'Purging...' : 'Confirm Full Purge'}
 </AlertDialogAction>
 </AlertDialogFooter>
 </AlertDialogContent>
 </AlertDialog>

 <AlertDialog open={showResetDialog} onOpenChange={setShowResetDialog}>
 <AlertDialogContent className="github-card border-warning/20 max-w-md">
 <AlertDialogHeader>
 <div className="w-12 h-12 rounded-md bg-warning/10 flex items-center justify-center mb-4 border border-warning/20">
 <RefreshCw className="w-6 h-6 text-warning" />
 </div>
 <AlertDialogTitle className="text-lg font-semibold text-foreground">Reset Settings?</AlertDialogTitle>
 <AlertDialogDescription className="text-sm text-muted-foreground leading-relaxed">
 Are you sure you want to reset all configuration settings to their default values? This will revert retention policies and security levels.
 </AlertDialogDescription>
 </AlertDialogHeader>
 <AlertDialogFooter className="mt-8 gap-3">
 <AlertDialogCancel className="github-btn github-btn-secondary">
 Cancel
 </AlertDialogCancel>
 <AlertDialogAction 
 onClick={resetSettings} 
 className="github-btn github-btn-primary bg-warning hover:bg-warning/90 text-white border-warning"
 >
 Reset Settings
 </AlertDialogAction>
 </AlertDialogFooter>
 </AlertDialogContent>
 </AlertDialog>
 </div>
 );
}

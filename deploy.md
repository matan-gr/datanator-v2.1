# 🚀 GCP Datanator: Production Deployment Guide

This guide provides a streamlined, logical path to deploying **GCP Datanator** to Google Cloud Run. It is optimized for production-grade persistence (using GCS FUSE for SQLite) and automated ETL scheduling.

---

## 🛠️ Step 0: Preparation & Variables

First, set your Project ID and enable the required Google Cloud APIs.

```bash
# 1. Set your active project
export PROJECT_ID="YOUR_PROJECT_ID"
gcloud config set project $PROJECT_ID

# 2. Enable all required APIs
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  cloudscheduler.googleapis.com \
  storage.googleapis.com \
  artifactregistry.googleapis.com
```

---

## 📦 Step 1: Infrastructure Setup

GCP Datanator requires a persistent storage bucket for the SQLite database and an Artifact Registry for the container image.

```bash
# 1. Create the persistent storage bucket (FUSE mount)
# This bucket will store your SQLite database and parsed feed files.
gcloud storage buckets create gs://${PROJECT_ID}-gcp-datanator-data --location=us-central1

# 2. Create the Artifact Registry repository
gcloud artifacts repositories create datanator-repo \
  --repository-format=docker \
  --location=us-central1 \
  --description="Docker repository for GCP Datanator"
```

---

## 🔐 Step 2: Security & Secrets

We use a dedicated Service Account for the application and store sensitive API keys in Secret Manager.

### 1. Create the Application Service Account
```bash
# Create the service account
gcloud iam service-accounts create gcp-datanator-app-sa \
    --display-name="GCP Datanator App Service Account"

# Grant it permission to manage the storage bucket
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
    --member="serviceAccount:gcp-datanator-app-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/storage.objectAdmin"
```

### 2. Configure Secrets
The app requires a Gemini API Key for AI features. (OAuth keys are optional but recommended for the "Export to GCS" feature).

```bash
# 1. Create the Gemini API Key secret
# Replace 'YOUR_KEY' with your key from https://aistudio.google.com/app/apikey
echo -n "YOUR_GEMINI_API_KEY" | gcloud secrets create GEMINI_API_KEY --data-file=-

# 2. Create placeholders for OAuth (or your actual keys)
echo -n "TODO" | gcloud secrets create GOOGLE_CLIENT_ID --data-file=-
echo -n "TODO" | gcloud secrets create GOOGLE_CLIENT_SECRET --data-file=-

# 3. Grant the Service Account access to read these secrets
for SECRET in GEMINI_API_KEY GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET; do
  gcloud secrets add-iam-policy-binding $SECRET \
    --member="serviceAccount:gcp-datanator-app-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
done
```

---

## 🚀 Step 3: Deployment (Cloud Build)

We use `cloudbuild.yaml` to automate the build and deployment. This configuration handles the complex volume mounting and concurrency settings required for SQLite on Cloud Run.

```bash
# Build the image and deploy to Cloud Run in one step
gcloud builds submit --config cloudbuild.yaml .
```

**What this command does:**
- Builds the container using `Dockerfile.txt`.
- Pushes the image to Artifact Registry.
- Deploys to Cloud Run with **Gen 2 environment** (required for FUSE).
- Mounts the GCS bucket to `/app/data`.
- Sets `--max-instances=1` to prevent SQLite database locks.
- Disables CPU throttling to ensure background syncs complete.

---

## ⏱️ Step 4: Automate the ETL Pipeline

To keep your data fresh, set up a Cloud Scheduler job to trigger the sync automatically.

### 1. Create the Scheduler Service Account
```bash
gcloud iam service-accounts create gcp-datanator-scheduler-sa \
    --display-name="GCP Datanator Scheduler Service Account"

# Grant it permission to invoke the Cloud Run service
gcloud run services add-iam-policy-binding gcp-datanator \
    --region=us-central1 \
    --member="serviceAccount:gcp-datanator-scheduler-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/run.invoker"
```

### 2. Create the Cron Job
This job triggers the sync every **Sunday, Tuesday, and Friday at 2:00 AM**.

```bash
# Get your Cloud Run URL
export SERVICE_URL=$(gcloud run services describe gcp-datanator --region=us-central1 --format='value(status.url)')

# Create the scheduler job
gcloud scheduler jobs create http gcp-datanator-sync \
  --schedule="0 2 * * 0,2,5" \
  --uri="${SERVICE_URL}/api/v1/sync/monthly?wait=true" \
  --http-method=GET \
  --oidc-service-account-email=gcp-datanator-scheduler-sa@${PROJECT_ID}.iam.gserviceaccount.com
```
*Note: Using `?wait=true` ensures Cloud Run keeps the CPU active until the sync finishes.*

---

## 🛡️ Architecture Highlights

- **Midnight Slate UI:** A production-grade, high-contrast dashboard for monitoring.
- **10 Data Sources:** Aggregates from official Google Cloud & AI blogs (including FeedBurner redirects).
- **Atomic Persistence:** Each sync generates a `.txt` data file and a `.index` tracking file (20 files total for 10 sources).
- **FUSE Mounting:** The `/app/data` directory is a live mount to GCS, ensuring your SQLite database (`gcp-datanator.db`) survives container restarts.
- **Concurrency Control:** Strictly limited to 1 instance to maintain SQLite integrity on network storage.

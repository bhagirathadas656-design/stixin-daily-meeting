# 🚀 100% Free Cloud Database & Hosting Guide (Zero Cost, No Credit Card)

This guide walks you through setting up the **absolute best, enterprise-grade, and 100% completely free** infrastructure for your STIXIN Daily Meeting platform:

- **Cloud Database:** **Supabase Cloud PostgreSQL** (100% Free Forever, Visual Table Dashboard, No Credit Card)
- **Cloud Hosting:** **Render.com Web Service** (100% Free Forever, No Credit Card, Free SSL/HTTPS)

---

## 📋 Part 1: Set Up Free Cloud Database on Supabase (60 Seconds)

1. Open **[https://supabase.com](https://supabase.com)** in your browser.
2. Click **Start your project** and sign in with your **GitHub** account *(No credit card required)*.
3. Click **New Project**:
   - **Name:** `stixin-daily`
   - **Database Password:** Enter any secure password (remember this password!).
   - **Region:** Pick the region closest to your team (e.g. `Singapore` or `Frankfurt`).
   - Click **Create new project**.
4. In your project dashboard:
   - Click the ⚙️ **Project Settings** icon on the left sidebar.
   - Go to **Database** ➔ scroll down to the **Connection string** section.
   - Select the **URI** tab.
   - Copy your connection string:
     ```
     postgresql://postgres.your-project-id:[YOUR-PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres
     ```
   *(Replace `[YOUR-PASSWORD]` with the password you created in step 3).*
5. Paste this connection string into your `.env` file or keep it ready for Part 2:
   ```bash
   DATABASE_URL=postgresql://postgres.your-project-id:your-password@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres
   ```

*That's it! Your Supabase database is ready. You can log into Supabase at any time and click **Table Editor** on the left to see all your meeting records, audio transcripts, and action items in an interactive spreadsheet view!*

---

## 🌐 Part 2: Host Website on Render.com for 100% Free (2 Minutes)

Render provides free hosting with automatic HTTPS and continuous deployment directly from your GitHub repository.

### Step 2.1: Upload Your Code to GitHub
You can upload this project to GitHub using either method:

* **Method A (No Git Installed - 1 Minute via Browser):**
  1. Go to **[https://github.com/new](https://github.com/new)** and create a new repository called `stixin-daily-meeting`.
  2. Click the link that says **"uploading an existing file"**.
  3. Drag and drop all the files from this folder (`STIXIN DAILY MEETING`) into GitHub and click **Commit changes**.

* **Method B (Using Git CLI):**
  ```bash
  git init
  git add .
  git commit -m "STIXIN Daily Meeting with AI Bot & Cloud DB"
  git branch -M main
  git remote add origin https://github.com/YOUR_GITHUB_USERNAME/stixin-daily-meeting.git
  git push -u origin main
  ```

### Step 2.2: Deploy on Render
1. Open **[https://render.com](https://render.com)**.
2. Click **Get Started** and sign in with your **GitHub** account *(No credit card required)*.
3. In your Dashboard, click **New +** ➔ **Web Service**.
4. Select your **stixin-daily-meeting** repository.
5. Fill in the basic settings (or let Render read the included `render.yaml` automatically):
   - **Name:** `stixin-daily-meeting`
   - **Runtime:** `Python`
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `python server.py`
   - **Instance Type:** `Free` ($0.00/month)
6. Under **Environment Variables**, click **Add Environment Variable**:
   - **Key:** `DATABASE_URL`
   - **Value:** *(Paste your Supabase connection string from Part 1)*
7. Click **Create Web Service**.

Within 2 minutes, Render will build and deploy your app, providing a **live public HTTPS URL**:
👉 **`https://stixin-daily-meeting.onrender.com`**

---

## 🐳 Alternative Part 2: Host on Your Own VPS with Docker

If you have your own Ubuntu / Linux VPS (e.g. AWS, DigitalOcean, Oracle Cloud):

1. Clone your repo onto your VPS.
2. Create `.env` and add your Supabase connection string:
   ```bash
   DATABASE_URL="postgresql://postgres.your-project-id:your-password@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres"
   ```
3. Run:
   ```bash
   docker-compose up -d --build
   ```
Your platform is now live on your VPS IP/Domain!

---

## 🔗 How Your Team Joins Daily

Once your website is hosted at your URL (e.g. `https://stixin-daily-meeting.onrender.com`):

Share these permanent daily links with your team:

| Team Member | Unique Permanent Daily Join Link |
| :--- | :--- |
| **Bhagirath (Tech Lead)** | `https://your-domain/?room=daily-standup&name=Bhagirath&autojoin=true` |
| **Rohan (Frontend)** | `https://your-domain/?room=daily-standup&name=Rohan&autojoin=true` |
| **Priya (Backend)** | `https://your-domain/?room=daily-standup&name=Priya&autojoin=true` |

When any team member clicks their link on their phone or laptop, they will **instantly enter the daily audio sync** with their name announced and audio connected!

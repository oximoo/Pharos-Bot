# 🚀 PHAROS V5 Auto Bot Setup Guide (Linux VPS)

This guide shows you how to run the **PHAROS V5 Bot** on a Linux VPS and keep it running automatically after reboot.  

---

## 1. Prepare your VPS

Update and install dependencies:

```bash
apt update -y
apt install -y unzip curl expect
```

Install **Node.js 20 LTS**:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node -v
npm -v
```

---

## 2. Upload and extract the bot

Create a working directory:

```bash
mkdir -p /opt/pharosv5
cd /opt/pharosv5
```

Upload your bot ZIP (from local PC to VPS):
# === Put your project here ===

# Download zip File 
[Download Zip](https://github.com/oximoo/Pharos-Bot/blob/main/PHAROSV5.zip)


# If the zip is on your local PC, upload it like:
```bash
scp -P <SSH_PORT> PHAROSV5.zip root@<SERVER_IP>:/opt/pharosv5/
```
# (replace <SSH_PORT> and <SERVER_IP>)

# If you've already uploaded PHAROSV5.zip to this server, unzip it:
Unzip:

```bash
unzip -o PHAROSV5.zip
cd PHAROSV5
```

Install dependencies:

```bash
npm install --omit=dev
```

---

## 3. Configure your keys and addresses

The bot uses **two files**:

- `wallets.txt` → contains **private keys** (one per line)  
- `wallet.txt` → contains **public addresses** (friends / receivers, optional)

Create `wallets.txt` (⚠️ private keys, keep safe!):

```bash
nano wallets.txt
```

Example:
```
0xYOURPRIVATEKEY_1 **public addresses**
0xYOURPRIVATEKEY_2 **private keys**
```
Then,
CTRL+O and Enter
CTRL+X and Enter
saved 

Create `wallet.txt` (optional, for send-to-friends features):

```bash
nano wallet.txt
```

Example:
```
0xFriendAddress1
0xFriendAddress2
```
Then,
CTRL+O and Enter
CTRL+X and Enter
saved 

Secure the files:

```bash
chmod 600 wallets.txt wallet.txt
```

---

## 4. Test run manually

```bash
cd /opt/pharosv5/PHAROSV5
node main.js
```

You’ll see a menu.  
For example:  
- `15` → Check Status  
- `17` → Run All Activities  

You’ll see a menu. Right now, “Run All Activities” is option 17. You can hit 17 + Enter to execute the full flow with defaults
---

## 5. Automate with Expect + systemd

Because the bot requires a menu selection, we’ll use an **Expect** script to auto-select option `17` (Run All Activities).  

### 5.1 Create Expect script

```bash
cat > /opt/pharosv5/auto.expect <<'EOF'
#!/usr/bin/expect -f
set timeout -1
cd /opt/pharosv5/PHAROSV5
spawn /usr/bin/node main.js

# Automatically choose option 17 (Run All Activities)
expect {
    -re {Select an option} {
        send "17\r"
        exp_continue
    }
    eof {
        exit
    }
}
EOF

chmod +x /opt/pharosv5/auto.expect
```

---

### 5.2 Create systemd service

```bash
cat > /etc/systemd/system/pharosbot.service <<'EOF'
[Unit]
Description=PharosV5 Bot (auto run)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/pharosv5/PHAROSV5
Environment=NODE_ENV=production
ExecStart=/usr/bin/expect -f /opt/pharosv5/auto.expect
Restart=always
RestartSec=10
# Log to journal (view with journalctl)
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
```

Enable and start:

```bash
systemctl daemon-reload
systemctl enable pharosbot
systemctl start pharosbot
```

---

## 6. Managing the bot

# Check status/logs
```bash
systemctl status pharosbot --no-pager
journalctl -u pharosbot -f
```

Check live logs:

```bash
journalctl -u pharosbot -f
```

Restart after editing files:

```bash
systemctl restart pharosbot
```

Stop bot:

```bash
systemctl stop pharosbot
```

Disable auto-start:

```bash
systemctl disable pharosbot
```

---

## 7. Security Notes ⚠️

- **Never** use your real mainnet wallet. Always use fresh keys.  
- Keep `wallets.txt` safe (`chmod 600`).  
- If you change private keys or addresses, edit the files and restart:
  ```bash
  systemctl restart pharosbot
  ```

## 8 Security tips

Never use a real/mainnet private key here. Use fresh keys for testnets.

Keep wallets.txt permissioned (chmod 600) and the server locked down (SSH key auth, firewall).

If you ever rotate keys, just update wallets.txt and restart: systemctl restart pharosbot.
```bash
apt install -y screen
screen -S pharos
cd /opt/pharosv5/PHAROSV5
node main.js   
```

# then select options
# Detach:  Ctrl+A, then D
# Reattach later:
```bash
screen -r pharos
```


---

✅ Done! Your PHAROS V5 bot will now run **24/7 on your VPS** and automatically restart after reboot.

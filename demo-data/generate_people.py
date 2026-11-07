"""Generate the Clean Room synthetic employee directory for Northstar Retail.

SYNTHETIC TRAINING DATA. Every person, password and secret here is fake.
Fixed seeds mean everyone on the team gets the identical dataset.

Usage:  python3 generate_people.py            # writes people.json + people.csv
"""
import base64, csv, hashlib, json, random
from datetime import datetime, timedelta, timezone
from faker import Faker

SEED = 2026
N = 40
DOMAIN = "northstar-retail.example"   # .example is reserved: can never be a real company
fake = Faker("en_US"); Faker.seed(SEED); rng = random.Random(SEED)
UTC = timezone.utc

# Department -> job titles (first title in each list is the department lead)
DEPTS = {
    "Executive": ["CEO", "COO"],
    "IT": ["IT Director", "Systems Administrator", "Network Engineer", "Help Desk Technician", "Help Desk Technician"],
    "Security": ["Security Analyst", "Security Engineer"],
    "Finance": ["CFO", "Accountant", "Accounts Payable Clerk", "Payroll Specialist"],
    "HR": ["HR Manager", "HR Generalist", "Recruiter"],
    "Legal": ["General Counsel"],
    "E-commerce": ["E-commerce Manager", "Web Developer", "Web Developer", "Database Administrator", "QA Tester"],
    "Customer Support": ["Support Manager", "Support Agent", "Support Agent", "Support Agent", "Support Agent"],
    "Marketing": ["Marketing Director", "Content Specialist", "Social Media Coordinator"],
    "Store Operations": ["Regional Store Manager", "Store Manager", "Store Manager", "Inventory Clerk", "Store Associate", "Store Associate"],
    "Warehouse": ["Warehouse Supervisor", "Logistics Coordinator", "Forklift Operator"],
}
SEASONS = ["Spring", "Summer", "Fall", "Winter"]

def weak_password(first):
    kind = rng.randrange(5)
    if kind == 0: return f"{rng.choice(SEASONS)}{rng.choice([2024, 2025, 2026])}!"
    if kind == 1: return f"{first}{rng.randrange(1970, 2005)}"
    if kind == 2: return rng.choice(["Password123", "Welcome1!", "Northstar1", "Qwerty2025"])
    if kind == 3: return f"Northstar#{rng.randrange(1, 100)}"
    return f"{first.lower()}{rng.randrange(100, 999)}"

def strong_password():
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*"
    return "".join(rng.choice(alphabet) for _ in range(18))

def hash_pw(pw, scheme):
    if scheme == "sha256-unsalted (legacy)":
        return "", hashlib.sha256(pw.encode()).hexdigest()
    salt = rng.randbytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, 100_000)
    return salt.hex(), dk.hex()

def totp_secret():
    return base64.b32encode(rng.randbytes(10)).decode()

def ts(dt): return dt.strftime("%Y-%m-%dT%H:%M:%SZ")

people = []
roles = [(d, t) for d, titles in DEPTS.items() for t in titles]
assert len(roles) == N - 1, len(roles)   # +1 service account below
used_names = set()
for i, (dept, title) in enumerate(roles, start=1):
    while True:
        first, last = fake.first_name(), fake.last_name()
        user = (first[0] + last).lower().replace("'", "")
        if user not in used_names: used_names.add(user); break
    privileged = title in {"IT Director", "Systems Administrator", "Network Engineer", "Database Administrator", "CEO", "CFO", "Payroll Specialist"}
    weak = rng.random() < 0.55
    pw = weak_password(first) if weak else strong_password()
    scheme = "sha256-unsalted (legacy)" if rng.random() < 0.2 else "pbkdf2-sha256"
    salt, h = hash_pw(pw, scheme)
    r = rng.random()
    mfa = "TOTP" if (privileged and r < 0.5) or r < 0.15 else "SMS" if r < 0.35 else "none"
    created = datetime(2015, 1, 1, tzinfo=UTC) + timedelta(days=rng.randrange(0, 4100))
    last_login = datetime(2026, 10, 26, tzinfo=UTC) + timedelta(minutes=rng.randrange(0, 60 * 24 * 7))
    people.append({
        "employee_id": f"NSR-{1000 + i}", "first_name": first, "last_name": last, "username": user,
        "email": f"{user}@{DOMAIN}", "department": dept, "job_title": title, "privileged_access": privileged,
        "password_leaked": pw, "password_strength": "weak" if weak else "strong",
        "hash_scheme": scheme, "salt_hex": salt, "password_hash": h,
        "mfa_type": mfa, "totp_secret": totp_secret() if mfa == "TOTP" else "",
        "account_created_utc": ts(created), "last_login_utc": ts(last_login),
        "credential_in_leak": False, "used_by_attacker": False, "account_status": "active",
        "incident_note": "",
    })

# Service account: the attacker's way in
salt, h = hash_pw("backup2019", "sha256-unsalted (legacy)")
people.append({
    "employee_id": "NSR-SVC-01", "first_name": "Backup", "last_name": "Service", "username": "svc_backup",
    "email": f"svc_backup@{DOMAIN}", "department": "IT", "job_title": "Service account (nightly backup)", "privileged_access": True,
    "password_leaked": "backup2019", "password_strength": "weak", "hash_scheme": "sha256-unsalted (legacy)", "salt_hex": salt, "password_hash": h,
    "mfa_type": "none", "totp_secret": "", "account_created_utc": "2019-04-02T14:00:00Z", "last_login_utc": "2026-11-01T03:12:00Z",
    "credential_in_leak": True, "used_by_attacker": True, "account_status": "disabled",
    "incident_note": "Suspected attacker login Sun 2026-11-01 03:12 UTC (matches forensic update E5). Disabled 2026-11-07 18:20 UTC.",
})

# Story: a dump of weak, no-MFA accounts is in the attacker's hands; one IT admin was used for lateral movement
leaked = [p for p in people if p["password_strength"] == "weak" and p["mfa_type"] == "none" and p["username"] != "svc_backup"]
for p in leaked[:9]: p["credential_in_leak"] = True
admin = next(p for p in people if p["job_title"] == "Systems Administrator")
admin.update(mfa_type="none", totp_secret="", credential_in_leak=True, used_by_attacker=True, account_status="disabled",
             password_leaked="Fall2025!", password_strength="weak", last_login_utc="2026-11-03T08:47:00Z",
             incident_note="Used for lateral movement from 2026-11-03 08:47 UTC, before the first known activity at 09:00. Disabled 2026-11-07 18:20 UTC.")
admin["salt_hex"], admin["password_hash"] = hash_pw("Fall2025!", admin["hash_scheme"])
for p in people:
    if p["credential_in_leak"] and not p["used_by_attacker"]:
        p["account_status"] = "password reset required"
        p["incident_note"] = "Credential found in attacker's dump; forced reset 2026-11-07."

if __name__ == "__main__":
    with open("people.json", "w") as f: json.dump({"synthetic": True, "label": "Synthetic training data", "seed": SEED, "people": people}, f, indent=2)
    with open("people.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(people[0])); w.writeheader(); w.writerows(people)
    print(f"{len(people)} people · leaked {sum(p['credential_in_leak'] for p in people)} · attacker-used {sum(p['used_by_attacker'] for p in people)} · "
          f"MFA none {sum(p['mfa_type']=='none' for p in people)} / SMS {sum(p['mfa_type']=='SMS' for p in people)} / TOTP {sum(p['mfa_type']=='TOTP' for p in people)}")

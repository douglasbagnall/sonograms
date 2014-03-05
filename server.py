#!/usr/bin/python

import random, re
import anydbm
import os, sys

from flask import Flask, render_template, request, make_response
app = Flask(__name__)

IGNORED = 'ignored'

PENDING_FILES = set()

WAV_DIR = 'static/wav'
#WAV_DIR = 'static/wav-test'

MOREPORKS_FOUND = 0
FILES_PROCESSED = 0
FILES_IGNORED = 0

def load_from_files(fn, ignored=None):
    """This is for when the database crashes."""
    if ignored:
        f = open(ignored)
        for line in f:
            line = line.strip()
            if line:
                DB[line] = IGNORED
        f.close()
    f = open(fn)
    for line in f:
        line = line.strip()
        if ' ' in line:
            fn, times = line.split(None, 1)
            DB[fn] = ' '.join('%.2f' % x for x in sanitise_times(times))
        elif line:
            DB[line] = ''
    f.close()

def set_up_dbm_and_file_list():
    global DB, FILES, MOREPORKS_FOUND, FILES_PROCESSED, FILES_IGNORED
    DB = anydbm.open('moreporks.dbm', 'c')
    # sync with filesystem on start up
    for dirpath, dirnames, filenames in os.walk(WAV_DIR, followlinks=True):
        d = re.sub(WAV_DIR + '/?', '', dirpath)
        for fn in filenames:
            if fn.endswith('.wav'):
                if d:
                    fn = d + '/' + fn
                try:
                    if fn not in DB:
                        PENDING_FILES.add(fn)
                except:
                    print >>sys.stderr, "couldn't add %s, stupid dbm" % fn

    for fn, moreporks in DB.iteritems():
        if moreporks == IGNORED:
            FILES_IGNORED += 1
        else:
            FILES_PROCESSED += 1
            MOREPORKS_FOUND += moreporks.count(' ') // 2
            ffn = os.path.join(WAV_DIR, fn)
            if not os.path.exists(ffn):
                print >> sys.stderr, "%s is missing" % ffn

    #load_from_files('times/consolidated-271.txt', 'ignored-272.txt')
    DB.sync()


def sanitise_times(times):
    if not times:
        return []
    if isinstance(times, (str, unicode)):
        times = times.encode('utf-8').strip()
        if ',' in times:
            times = times.split(',')
        else:
            times = times.split()
    if len(times) & 1:
        raise ValueError("len(times) is odd: %d" % len(times))
    times = [float(x) for x in times]

    #so, now times is a possibly empty list of floats
    #split it into pairs
    pairs = [times[i : i + 2] for i in range(0, len(times), 2)]
    for s, e in pairs:
        if e < s:
            raise ValueError("pair %s,%s has end before start" % (s, e))
    pairs.sort()
    ls, le = pairs[0]
    combined = []
    for i in range(1, len(pairs)):
        rs, re = pairs[i]
        if rs <= le: #overlap --> merge
            le = re
        else:
            combined.append(ls)
            combined.append(le)
            ls = rs
            le = re
    combined.append(ls)
    combined.append(le)
    return combined


def save_results():
    global FILES_PROCESSED, FILES_IGNORED, MOREPORKS_FOUND
    if request.method == 'POST':
        get = request.form.get
    else:
        get = request.args.get
    wav = get('wav')
    if wav is None:
        return "Hello!"
    wav = wav.encode('utf-8')
    if not wav in PENDING_FILES:
        return "wav file '%s' is unknown" % wav
    if get('skip'):
        return "Skipped '%s'" % wav
    PENDING_FILES.discard(wav)
    if get('ignore'):
        DB[wav] = IGNORED
        FILES_IGNORED += 1
        return "added '%s' to ignored list" % wav
    morepork_string = get('moreporks')
    morepork_times = sanitise_times(morepork_string)

    FILES_PROCESSED += 1
    MOREPORKS_FOUND += len(morepork_times) // 2
    DB[wav] = ' '.join("%.2f" % x for x in morepork_times)
    DB.sync()
    return "saved %d moreporks in %s" % (len(morepork_times) / 2, wav)


@app.route('/', methods=['GET', 'POST'])
def main_page():
    msg = save_results()
    if PENDING_FILES:
        wav = random.sample(PENDING_FILES, 1)[0]
    else:
        wav = None
    return render_template('audio.html', wav=wav, wavdir=WAV_DIR, msg=msg,
                           files_remaining=len(PENDING_FILES),
                           files_processed=FILES_PROCESSED, files_ignored=FILES_IGNORED,
                           moreporks_found=MOREPORKS_FOUND)

@app.route('/results.txt')
def results():
    #this bizarre sorting happens here because unsorted values have
    #already got into the database.
    lines = []
    ignored = []
    for k, v in DB.iteritems():
        if v == IGNORED:
            ignored.append(k)
        else:
            s = ' '.join('%s' % x for x in sanitise_times(v))
            lines.append("%s %s\n" % (k, s))

    lines.sort()
    text = ''.join(lines)
    f = open('results-%d.txt' % len(lines), 'w')
    f.write(text)
    f.close()
    f = open('ignored-%d.txt' % len(lines), 'w')
    f.write('\n'.join(ignored) + '\n')
    f.close()

    response = make_response(text)
    response.headers["content-type"] = "text/plain"
    DB.sync()

    return response

set_up_dbm_and_file_list()

if __name__ == '__main__':
    try:
        if True:
            app.run(debug=True)
        else:
            app.run(host='0.0.0.0')
    finally:
        DB.close()

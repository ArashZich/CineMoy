// Starts Node.js (nodejs-mobile) and forwards its stdout/stderr to logcat ("CineMoyNode").
#include <jni.h>
#include <android/log.h>
#include <pthread.h>
#include <unistd.h>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "node.h"

namespace {

const char *kTag = "CineMoyNode";
int stdoutPipe[2];
int stderrPipe[2];

void *forward(void *arg) {
    const int fd = *static_cast<int *>(arg);
    const int priority = fd == stderrPipe[0] ? ANDROID_LOG_ERROR : ANDROID_LOG_INFO;
    char buf[2048];
    ssize_t n;
    while ((n = read(fd, buf, sizeof(buf) - 1)) > 0) {
        if (buf[n - 1] == '\n') --n;
        buf[n] = '\0';
        __android_log_write(priority, kTag, buf);
    }
    return nullptr;
}

void redirectStdio() {
    setvbuf(stdout, nullptr, _IONBF, 0);
    setvbuf(stderr, nullptr, _IONBF, 0);
    pipe(stdoutPipe);
    pipe(stderrPipe);
    dup2(stdoutPipe[1], STDOUT_FILENO);
    dup2(stderrPipe[1], STDERR_FILENO);
    pthread_t out, err;
    pthread_create(&out, nullptr, forward, &stdoutPipe[0]);
    pthread_create(&err, nullptr, forward, &stderrPipe[0]);
    pthread_detach(out);
    pthread_detach(err);
}

}  // namespace

extern "C" JNIEXPORT jint JNICALL
Java_app_cinemoy_NodeEngine_startNode(JNIEnv *env, jclass, jobjectArray arguments) {
    // node::Start expects all argv strings in one contiguous block of memory.
    const jsize argc = env->GetArrayLength(arguments);
    std::vector<std::string> args;
    size_t total = 0;
    for (jsize i = 0; i < argc; i++) {
        auto js = static_cast<jstring>(env->GetObjectArrayElement(arguments, i));
        const char *s = env->GetStringUTFChars(js, nullptr);
        args.emplace_back(s);
        total += args.back().size() + 1;
        env->ReleaseStringUTFChars(js, s);
        env->DeleteLocalRef(js);
    }
    char *block = static_cast<char *>(calloc(total, 1));
    std::vector<char *> argv;
    char *cursor = block;
    for (const auto &a : args) {
        memcpy(cursor, a.c_str(), a.size());
        argv.push_back(cursor);
        cursor += a.size() + 1;
    }
    redirectStdio();
    return static_cast<jint>(node::Start(argc, argv.data()));
}

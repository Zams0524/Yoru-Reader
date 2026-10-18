package com.yorureader.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.IOException;

@CapacitorPlugin(name = "AndroidDiagnostics")
public class AndroidDiagnosticsPlugin extends Plugin {
    private static final int MAX_REPORT_CHARACTERS = 60000;

    @PluginMethod
    public void getLastCrashReport(PluginCall call) {
        File reportFile = new File(getContext().getFilesDir(), MainActivity.CRASH_REPORT_FILE);
        if (!reportFile.isFile()) {
            JSObject response = new JSObject();
            response.put("report", "");
            call.resolve(response);
            return;
        }

        StringBuilder report = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new FileReader(reportFile))) {
            char[] buffer = new char[2048];
            int count;
            while ((count = reader.read(buffer)) >= 0 && report.length() < MAX_REPORT_CHARACTERS) {
                int remaining = MAX_REPORT_CHARACTERS - report.length();
                report.append(buffer, 0, Math.min(count, remaining));
            }
            JSObject response = new JSObject();
            response.put("report", report.toString());
            call.resolve(response);
        } catch (IOException error) {
            call.reject("No se pudo leer el informe del cierre: " + error.getMessage(), error);
        }
    }

    @PluginMethod
    public void clearLastCrashReport(PluginCall call) {
        File reportFile = new File(getContext().getFilesDir(), MainActivity.CRASH_REPORT_FILE);
        if (reportFile.exists() && !reportFile.delete()) {
            call.reject("No se pudo borrar el informe del cierre.");
            return;
        }
        call.resolve();
    }
}

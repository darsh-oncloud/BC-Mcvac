/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define([
    'N/record',
    'N/render',
    'N/email',
    'N/file',
    'N/log'
], (
    record,
    render,
    email,
    file,
    log
) => {

    // XML file internal ID
    const TEMPLATE_FILE_ID = 33686;

    // Employee used as the email sender
    const SENDER_EMPLOYEE_ID = 9710;

    // Employee receiving the test email
    // NetSuite will send the email to the email address
    // configured on this Employee record.
    const RECIPIENT_EMPLOYEE_ID = 9710;

    // Support Case field on the Task
    const CASE_LINK_FIELD_ID = 'supportcase';

    // Task status configuration
    const STATUS_FIELD_ID = 'status';
    const STATUS_COMPLETE_VALUE = 'COMPLETE';

    // Customer signature field on Task
    const SIGNATURE_FIELD_ID = 'custevent_nx_customer_signature';

    /**
     * Safely get a field value.
     */
    const safeGetValue = (rec, fieldId) => {
        try {
            return rec.getValue({
                fieldId: fieldId
            });
        } catch (e) {
            return '';
        }
    };

    /**
     * Creates the renderer and adds all records.
     *
     * XML Task references:
     * ${record.title}
     * ${record.custevent_nx_customer_signature}
     *
     * The Task is also available as:
     * ${task.title}
     *
     * Support Case references:
     * ${supportCase.casenumber}
     * ${supportCase.title}
     */
    const createReportRenderer = (
        templateContent,
        taskRec,
        caseRec
    ) => {

        const renderer = render.create();

        renderer.templateContent = templateContent;

        // Main record in the XML is the Task
        renderer.addRecord({
            templateName: 'record',
            record: taskRec
        });

        // Also provide the Task using the task alias
        renderer.addRecord({
            templateName: 'task',
            record: taskRec
        });

        // Related Support Case
        renderer.addRecord({
            templateName: 'supportCase',
            record: caseRec
        });

        return renderer;
    };

    const afterSubmit = (context) => {
        try {
            const allowedEvents = [
                context.UserEventType.CREATE,
                context.UserEventType.EDIT,
                context.UserEventType.XEDIT
            ];

            if (allowedEvents.indexOf(context.type) === -1) {
                return;
            }

            const taskId = context.newRecord.id;

            if (!taskId) {
                log.error({
                    title: 'Missing Task ID',
                    details: 'Task internal ID was not available.'
                });
                return;
            }

            log.audit({
                title: 'Service Report Started',
                details: {
                    taskId: taskId,
                    eventType: context.type
                }
            });

            // ---------------------------------------------------------
            // Load complete Task record
            // ---------------------------------------------------------

            const taskRec = record.load({
                type: record.Type.TASK,
                id: taskId,
                isDynamic: false
            });

            // ---------------------------------------------------------
            // Validation 1: Task must be Complete
            // ---------------------------------------------------------

            const status = taskRec.getValue({
                fieldId: STATUS_FIELD_ID
            });

            log.debug({
                title: 'Task Status Validation',
                details: {
                    taskId: taskId,
                    currentStatus: status,
                    requiredStatus: STATUS_COMPLETE_VALUE
                }
            });

            if (status !== STATUS_COMPLETE_VALUE) {
                log.audit({
                    title: 'Report Skipped - Task Not Complete',
                    details: {
                        taskId: taskId,
                        status: status
                    }
                });
                return;
            }

            // ---------------------------------------------------------
            // Validation 2: Customer signature must be populated
            // ---------------------------------------------------------

            const signature = taskRec.getValue({
                fieldId: SIGNATURE_FIELD_ID
            });

            log.debug({
                title: 'Signature Validation',
                details: {
                    taskId: taskId,
                    signaturePopulated: Boolean(signature),
                    signatureValue: signature
                }
            });

            if (!signature) {
                log.audit({
                    title: 'Report Skipped - Signature Missing',
                    details: {
                        taskId: taskId,
                        signatureField: SIGNATURE_FIELD_ID
                    }
                });
                return;
            }

            // ---------------------------------------------------------
            // Validation 3: Support Case must be populated
            // ---------------------------------------------------------

            const caseIdValue = taskRec.getValue({
                fieldId: CASE_LINK_FIELD_ID
            });

            const caseId = Number(caseIdValue);

            log.debug({
                title: 'Support Case Validation',
                details: {
                    taskId: taskId,
                    caseFieldValue: caseIdValue,
                    caseId: caseId
                }
            });

            if (!caseIdValue || !caseId || isNaN(caseId)) {
                log.error({
                    title: 'Report Skipped - Invalid Support Case',
                    details: {
                        taskId: taskId,
                        fieldId: CASE_LINK_FIELD_ID,
                        fieldValue: caseIdValue
                    }
                });
                return;
            }

            // ---------------------------------------------------------
            // Load Support Case
            // ---------------------------------------------------------

            const caseRec = record.load({
                type: record.Type.SUPPORT_CASE,
                id: caseId,
                isDynamic: false
            });

            const caseNumber =
                safeGetValue(caseRec, 'casenumber') || caseId;

            log.debug({
                title: 'Support Case Loaded',
                details: {
                    caseId: caseId,
                    caseNumber: caseNumber,
                    caseTitle: safeGetValue(caseRec, 'title'),
                    company: safeGetValue(caseRec, 'company'),
                    caseStatus: safeGetValue(caseRec, 'status')
                }
            });

            // ---------------------------------------------------------
            // Validate recipient Employee
            // ---------------------------------------------------------

            const recipientEmployeeRec = record.load({
                type: record.Type.EMPLOYEE,
                id: RECIPIENT_EMPLOYEE_ID,
                isDynamic: false
            });

            const recipientEmail = recipientEmployeeRec.getValue({
                fieldId: 'email'
            });

            const recipientName =
                recipientEmployeeRec.getValue({
                    fieldId: 'entityid'
                }) ||
                recipientEmployeeRec.getValue({
                    fieldId: 'firstname'
                });

            log.debug({
                title: 'Recipient Employee',
                details: {
                    employeeId: RECIPIENT_EMPLOYEE_ID,
                    employeeName: recipientName,
                    employeeEmail: recipientEmail
                }
            });

            if (!recipientEmail) {
                log.error({
                    title: 'Recipient Employee Has No Email',
                    details:
                        'Employee internal ID ' +
                        RECIPIENT_EMPLOYEE_ID +
                        ' does not have an email address.'
                });
                return;
            }

            // ---------------------------------------------------------
            // Load XML template
            // ---------------------------------------------------------

            const templateFile = file.load({
                id: TEMPLATE_FILE_ID
            });

            const templateContent = templateFile.getContents();

            if (!templateContent) {
                log.error({
                    title: 'Empty XML Template',
                    details:
                        'Template file ' +
                        TEMPLATE_FILE_ID +
                        ' does not contain XML content.'
                });
                return;
            }

            const templateVariables =
                templateContent.match(/\$\{[^}]+\}/g) || [];

            log.debug({
                title: 'XML Template Information',
                details: {
                    templateId: TEMPLATE_FILE_ID,
                    templateName: templateFile.name,
                    templateSize: templateContent.length,
                    variables: templateVariables.slice(0, 100)
                }
            });

            // ---------------------------------------------------------
            // Render merged XML for debugging
            // ---------------------------------------------------------

            try {
                const previewRenderer = createReportRenderer(
                    templateContent,
                    taskRec,
                    caseRec
                );

                const renderedXml = previewRenderer.renderAsString();

                log.debug({
                    title: 'Rendered XML Preview',
                    details: renderedXml
                        ? renderedXml.substring(0, 3900)
                        : 'Rendered XML was empty.'
                });

            } catch (previewError) {
                log.error({
                    title: 'Rendered XML Preview Error',
                    details: {
                        name: previewError.name,
                        message: previewError.message
                    }
                });
            }

            // ---------------------------------------------------------
            // Generate PDF
            // ---------------------------------------------------------

            const pdfRenderer = createReportRenderer(
                templateContent,
                taskRec,
                caseRec
            );

            const pdfFile = pdfRenderer.renderAsPdf();

            pdfFile.name =
                'Case_Service_Report_' +
                caseNumber +
                '_Task_' +
                taskId +
                '.pdf';

            log.audit({
                title: 'PDF Generated',
                details: {
                    taskId: taskId,
                    caseId: caseId,
                    caseNumber: caseNumber,
                    pdfName: pdfFile.name,
                    pdfSize: pdfFile.size
                }
            });

            // ---------------------------------------------------------
            // Send email using Employee internal ID
            // ---------------------------------------------------------

            email.send({
                author: SENDER_EMPLOYEE_ID,

                // Recipient is an Employee internal ID
                recipients: RECIPIENT_EMPLOYEE_ID,

                subject:
                    'Case Service Report - Case #' +
                    caseNumber,

                body:
                    'Hi ' +
                    (recipientName || '') +
                    ',\n\n' +
                    'Please find attached the service report for Case #' +
                    caseNumber +
                    '.\n\n' +
                    'Task Internal ID: ' +
                    taskId +
                    '\n' +
                    'Support Case Internal ID: ' +
                    caseId +
                    '\n\n' +
                    'The report was generated automatically after the ' +
                    'Task was completed and the customer signature was captured.' +
                    '\n\nThank you.',

                attachments: [
                    pdfFile
                ]
            });

            log.audit({
                title: 'Service Report Email Sent',
                details: {
                    taskId: taskId,
                    caseId: caseId,
                    caseNumber: caseNumber,
                    recipientEmployeeId: RECIPIENT_EMPLOYEE_ID,
                    recipientEmail: recipientEmail,
                    senderEmployeeId: SENDER_EMPLOYEE_ID,
                    pdfName: pdfFile.name
                }
            });

        } catch (e) {
            log.error({
                title: 'Service Report afterSubmit Error',
                details: {
                    name: e.name || '',
                    message: e.message || String(e),
                    stack: e.stack || ''
                }
            });
        }
    };

    return {
        afterSubmit: afterSubmit
    };
});
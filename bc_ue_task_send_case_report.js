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

    // XML template file internal ID
    const TEMPLATE_FILE_ID = 33686;

    // Employee internal ID used as email sender
    const SENDER_ID = 9710;

    // Task conditions
    const STATUS_FIELD_ID = 'status';
    const COMPLETE_STATUS = 'COMPLETE';
    const CUSTOMER_SIGNATURE_FIELD =
        'custevent_nx_customer_signature';

    // Currently not used during testing
    const CUSTOMER_EMAIL_FIELD =
        'custevent_bc_fsm_cust_email';

    // Testing recipient
    const TEST_EMAIL =
        'dhruv.soni@bluecollar.cloud';

    /**
     * Safely gets a field value.
     */
    const getValue = (rec, fieldId) => {
        try {
            const value = rec.getValue({
                fieldId: fieldId
            });

            if (value === null || value === undefined) {
                return '';
            }

            return value;

        } catch (e) {
            return '';
        }
    };

    /**
     * Safely gets a field's displayed text.
     */
    const getText = (rec, fieldId) => {
        try {
            const value = rec.getText({
                fieldId: fieldId
            });

            if (value === null || value === undefined) {
                return '';
            }

            return value;

        } catch (e) {
            return '';
        }
    };

    /**
     * Gets displayed text first, otherwise gets the raw value.
     */
    const getTextOrValue = (rec, fieldId) => {
        const text = getText(rec, fieldId);

        if (text !== '') {
            return text;
        }

        return getValue(rec, fieldId);
    };

    /**
     * Returns the first populated value.
     */
    const firstValue = (values) => {
        for (let i = 0; i < values.length; i++) {
            if (
                values[i] !== null &&
                values[i] !== undefined &&
                values[i] !== ''
            ) {
                return values[i];
            }
        }

        return '';
    };

    /**
     * Add a JavaScript object to the XML template.
     */
    const addObjectSource = (renderer, alias, data) => {
        renderer.addCustomDataSource({
            format: render.DataSource.OBJECT,
            alias: alias,
            data: data
        });
    };

    const afterSubmit = (context) => {
        try {
            if (
                context.type !== context.UserEventType.CREATE &&
                context.type !== context.UserEventType.EDIT &&
                context.type !== context.UserEventType.XEDIT
            ) {
                return;
            }

            const taskId = context.newRecord.id;

            if (!taskId) {
                log.error({
                    title: 'Missing Task ID',
                    details: 'Task ID was not available.'
                });

                return;
            }

            /*
             * Load the complete Task record.
             *
             * This is especially important for XEDIT because
             * context.newRecord may only contain changed fields.
             */
            const taskRec = record.load({
                type: record.Type.TASK,
                id: taskId,
                isDynamic: false
            });

            // ---------------------------------------------------------
            // Condition 1: Task must be Complete
            // ---------------------------------------------------------

            const taskStatus = getValue(
                taskRec,
                STATUS_FIELD_ID
            );

            log.debug({
                title: 'Task Status Check',
                details: {
                    taskId: taskId,
                    currentStatus: taskStatus,
                    requiredStatus: COMPLETE_STATUS
                }
            });

            if (taskStatus !== COMPLETE_STATUS) {
                log.debug({
                    title: 'Skipped - Task Not Complete',
                    details:
                        'Task ' + taskId +
                        ' status is "' + taskStatus + '".'
                });

                return;
            }

            // ---------------------------------------------------------
            // Condition 2: Customer signature must exist
            // ---------------------------------------------------------

            const customerSignature = getValue(
                taskRec,
                CUSTOMER_SIGNATURE_FIELD
            );

            if (!customerSignature) {
                log.debug({
                    title: 'Skipped - Signature Missing',
                    details:
                        'Task ' + taskId +
                        ' does not have a customer signature.'
                });

                return;
            }

            // ---------------------------------------------------------
            // Customer email logic - commented out for testing
            // ---------------------------------------------------------

            /*
            const reportEmail = getValue(
                taskRec,
                CUSTOMER_EMAIL_FIELD
            );

            if (!reportEmail) {
                log.debug({
                    title: 'Skipped - Email Missing',
                    details:
                        'Task ' + taskId +
                        ' does not have a customer email.'
                });

                return;
            }
            */

            // Testing email only
            const reportEmail = TEST_EMAIL;

            // ---------------------------------------------------------
            // Read Task data
            // ---------------------------------------------------------

            const taskNumber = firstValue([
                getTextOrValue(
                    taskRec,
                    'custevent_nx_task_number'
                ),
                String(taskId)
            ]);

            const taskTitle = getTextOrValue(
                taskRec,
                'title'
            );

            const companyId = getValue(
                taskRec,
                'company'
            );

            const companyName = getTextOrValue(
                taskRec,
                'company'
            );

            const customerId = getValue(
                taskRec,
                'custevent_nx_customer'
            );

            const customerName = getTextOrValue(
                taskRec,
                'custevent_nx_customer_name'
            );

            const technicianName = getTextOrValue(
                taskRec,
                'custevent_bc_fsm_tech_name'
            );

            const technicianSignature = getValue(
                taskRec,
                'custevent_nx_technician_signature'
            );

            const address = getTextOrValue(
                taskRec,
                'custevent_nx_address'
            );

            const assetId = getValue(
                taskRec,
                'custevent_nx_task_asset'
            );

            const assetName = getTextOrValue(
                taskRec,
                'custevent_nx_task_asset'
            );

            const taskTypeId = getValue(
                taskRec,
                'custevent_nx_task_type'
            );

            const taskTypeName = getTextOrValue(
                taskRec,
                'custevent_nx_task_type'
            );

            const serviceDate = firstValue([
                getTextOrValue(
                    taskRec,
                    'custevent_nx_start_date'
                ),
                getTextOrValue(
                    taskRec,
                    'calendardate'
                ),
                getTextOrValue(
                    taskRec,
                    'startdate'
                )
            ]);

            const serviceTime = firstValue([
                getTextOrValue(
                    taskRec,
                    'custevent_nx_start_time'
                ),
                getTextOrValue(
                    taskRec,
                    'starttime'
                )
            ]);

            const serviceEndDate = firstValue([
                getTextOrValue(
                    taskRec,
                    'custevent_nx_end_date'
                ),
                getTextOrValue(
                    taskRec,
                    'enddate'
                )
            ]);

            const serviceEndTime = firstValue([
                getTextOrValue(
                    taskRec,
                    'custevent_nx_end_time'
                ),
                getTextOrValue(
                    taskRec,
                    'endtime'
                )
            ]);

            const assignedEmployeeId = getValue(
                taskRec,
                'assigned'
            );

            const assignedEmployeeName = getTextOrValue(
                taskRec,
                'assigned'
            );

            // ---------------------------------------------------------
            // Main Task mapping
            // ---------------------------------------------------------

            const taskData = {
                id: String(taskId),
                internalid: String(taskId),
                type: 'task',

                title: taskTitle,
                status: taskStatus,

                tasknumber: taskNumber,
                custevent_nx_task_number: taskNumber,

                company: companyName,
                companyid: String(companyId || ''),

                assigned: assignedEmployeeName,
                assignedid: String(assignedEmployeeId || ''),

                calendardate: serviceDate,
                startdate: serviceDate,
                starttime: serviceTime,
                enddate: serviceEndDate,
                endtime: serviceEndTime,

                custevent_nx_start_date: serviceDate,
                custevent_nx_start_time: serviceTime,
                custevent_nx_end_date: serviceEndDate,
                custevent_nx_end_time: serviceEndTime,

                custevent_nx_address: address,

                custevent_nx_customer:
                    String(customerId || ''),

                custevent_nx_customer_name:
                    customerName,

                custevent_bc_fsm_tech_name:
                    technicianName,

                custevent_nx_task_asset:
                    assetName,

                custevent_nx_task_asset_id:
                    String(assetId || ''),

                custevent_nx_task_type:
                    taskTypeName,

                custevent_nx_task_type_id:
                    String(taskTypeId || ''),

                custevent_nx_customer_signature:
                    customerSignature,

                custevent_nx_technician_signature:
                    technicianSignature
            };

            /*
             * The template references values such as:
             *
             * ${case.casenumber}
             * ${case.contact.entityid}
             * ${case.custevent_nx_customer.companyname}
             * ${case.company}
             *
             * We are not loading the Support Case.
             * Instead, Task data is mapped into the "case" alias.
             */
            const caseData = {
                id: String(taskId),

                // Show Task number where XML expects case number
                casenumber: taskNumber,

                company: companyName,

                contact: {
                    entityid: customerName
                },

                custevent_nx_customer: {
                    id: String(customerId || ''),
                    companyname: companyName
                },

                custevent_bc_fsm_tech_name:
                    technicianName,

                custevent_nx_customer_name:
                    customerName,

                custevent_nx_address:
                    address,

                custevent_nx_task_asset:
                    assetName,

                custevent_nx_task_type:
                    taskTypeName,

                custevent_nx_technician_signature:
                    technicianSignature,

                custevent_nx_customer_signature:
                    customerSignature
            };

            /*
             * The XML references:
             *
             * ${serviceOrder.custbody_bc_arrival_time}
             */
            const serviceOrderData = {
                id: String(taskId),

                tranid: taskNumber,
                title: taskTitle,

                trandate: serviceDate,
                serviceDate: serviceDate,
                serviceTime: serviceTime,

                startdate: serviceDate,
                starttime: serviceTime,
                enddate: serviceEndDate,
                endtime: serviceEndTime,

                custbody_bc_arrival_time:
                    serviceTime,

                technician:
                    technicianName,

                customer:
                    customerName,

                company:
                    companyName,

                address:
                    address,

                asset:
                    assetName,

                tasktype:
                    taskTypeName
            };

            /*
             * The XML also uses dynamic record references such as:
             *
             * ${record[field.inlineimage]}
             * ${record[field.image]}
             *
             * Give it the same Task mapping under "record".
             */
            const recordData = Object.assign(
                {},
                taskData
            );

            log.debug({
                title: 'Mapped Task Service Report Data',
                details: {
                    taskId: taskId,
                    taskNumber: taskNumber,
                    companyName: companyName,
                    customerName: customerName,
                    technicianName: technicianName,
                    address: address,
                    assetName: assetName,
                    taskTypeName: taskTypeName,
                    serviceDate: serviceDate,
                    serviceTime: serviceTime,
                    technicianSignaturePopulated:
                        Boolean(technicianSignature),
                    customerSignaturePopulated:
                        Boolean(customerSignature)
                }
            });

            // ---------------------------------------------------------
            // Load XML template
            // ---------------------------------------------------------

            const templateFile = file.load({
                id: TEMPLATE_FILE_ID
            });

            const templateContent =
                templateFile.getContents();

            if (!templateContent) {
                log.error({
                    title: 'Empty XML Template',
                    details:
                        'Template file ' +
                        TEMPLATE_FILE_ID +
                        ' is empty.'
                });

                return;
            }

            // ---------------------------------------------------------
            // Create renderer and add all mappings
            // ---------------------------------------------------------

            const renderer = render.create();

            renderer.templateContent =
                templateContent;

            addObjectSource(
                renderer,
                'task',
                taskData
            );

            addObjectSource(
                renderer,
                'case',
                caseData
            );

            addObjectSource(
                renderer,
                'serviceOrder',
                serviceOrderData
            );

            addObjectSource(
                renderer,
                'record',
                recordData
            );

            /*
             * First render the FreeMarker template into final XML.
             *
             * This lets the log confirm that the Task values were
             * inserted before the XML is converted to PDF.
             */
            const renderedXml =
                renderer.renderAsString();

            if (!renderedXml) {
                log.error({
                    title: 'Rendered XML Is Empty',
                    details:
                        'The template did not produce XML.'
                });

                return;
            }

            log.audit({
                title: 'Rendered XML Validation',
                details: {
                    taskId: taskId,

                    xmlLength:
                        renderedXml.length,

                    containsTaskNumber:
                        renderedXml.indexOf(
                            String(taskNumber)
                        ) !== -1,

                    containsCustomer:
                        customerName
                            ? renderedXml.indexOf(
                                customerName
                            ) !== -1
                            : false,

                    containsTechnician:
                        technicianName
                            ? renderedXml.indexOf(
                                technicianName
                            ) !== -1
                            : false,

                    containsAddress:
                        address
                            ? renderedXml.indexOf(
                                '481 GRAND AVENUE'
                            ) !== -1
                            : false,

                    containsSignatureImage:
                        renderedXml.indexOf(
                            'data:image/png;base64'
                        ) !== -1
                }
            });

            // ---------------------------------------------------------
            // Convert rendered XML into PDF
            // ---------------------------------------------------------

            const pdfFile = render.xmlToPdf({
                xmlString: renderedXml
            });

            pdfFile.name =
                'Task_Service_Report_' +
                taskNumber +
                '.pdf';

            log.audit({
                title: 'Task Service Report Generated',
                details: {
                    taskId: taskId,
                    taskNumber: taskNumber,
                    templateFileId:
                        TEMPLATE_FILE_ID,
                    pdfName: pdfFile.name,
                    pdfSize: pdfFile.size
                }
            });

            // ---------------------------------------------------------
            // Send PDF to hardcoded testing email
            // ---------------------------------------------------------

            email.send({
                author: SENDER_ID,

                recipients: reportEmail,

                subject:
                    'Task Service Report - Task #' +
                    taskNumber,

                body:
                    'Hi,\n\n' +
                    'Please find attached the service report ' +
                    'for Task #' + taskNumber + '.\n\n' +
                    'The report was generated automatically ' +
                    'after the Task was completed and the ' +
                    'customer signature was captured.\n\n' +
                    'Thank you.',

                attachments: [
                    pdfFile
                ]

                /*
                 * No relatedRecords.
                 *
                 * The email will not be attached to the
                 * Task, Case, Employee, or Customer record.
                 */
            });

            log.audit({
                title: 'Task Service Report Sent',
                details: {
                    taskId: taskId,
                    taskNumber: taskNumber,
                    recipient: reportEmail,
                    senderEmployeeId: SENDER_ID,
                    pdfName: pdfFile.name,
                    pdfSize: pdfFile.size
                }
            });

        } catch (e) {
            log.error({
                title: 'Task Service Report Error',
                details: {
                    name: e.name || '',
                    message:
                        e.message || String(e),
                    stack: e.stack || ''
                }
            });
        }
    };

    return {
        afterSubmit: afterSubmit
    };
});